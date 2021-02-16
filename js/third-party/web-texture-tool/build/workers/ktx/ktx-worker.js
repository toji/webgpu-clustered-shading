/**
 * @file Web Worker for loading/transcoding KTX files
 * @module KTXLoader
 *
 * Loads the Khronos Standard KTX2 file format (spec: http://github.khronos.org/KTX-Specification/)
 * Basis transcoding is handled by Web Assembly code in msc_transcoder_wrapper.wasm, which is maintained at
 * https://github.com/KhronosGroup/KTX-Software
 */

importScripts('../worker-util.js');
importScripts('libktx.js');

// eslint-disable-next-line new-cap
const KTX_INITIALIZED = new Promise((resolve) => {
  // Turns out this isn't a "real" promise, so we can't use it with await later on. Hence the wrapper promise.
  // eslint-disable-next-line new-cap
  LIBKTX().then(resolve);
});

const WTT_FORMAT_MAP = {
  // Compressed formats
  BC1_RGB: {format: 'bc1-rgb-unorm'},
  BC3_RGBA: {format: 'bc3-rgba-unorm'},
  BC7_M5_RGBA: {format: 'bc7-rgba-unorm'},
  ETC1_RGB: {format: 'etc1-rgb-unorm'},
  ETC2_RGBA: {format: 'etc2-rgba8unorm'},
  ASTC_4x4_RGBA: {format: 'astc-4x4-rgba-unorm'},
  PVRTC1_4_RGB: {format: 'pvrtc1-4bpp-rgb-unorm'},
  PVRTC1_4_RGBA: {format: 'pvrtc1-4bpp-rgba-unorm'},

  // Uncompressed formats
  RGBA32: {format: 'rgba8unorm', uncompressed: true},
  RGB565: {format: 'rgb565unorm', uncompressed: true},
  RGBA4444: {format: 'rgba4unorm', uncompressed: true},
};

// See http://richg42.blogspot.com/2018/05/basis-universal-gpu-texture-format.html for details.
// ETC1 Should be the highest quality, so use when available.
// If we don't support any appropriate compressed formats transcode to raw RGB(A) pixels. This is something of a last
// resort, because the GPU upload will be significantly slower and take a lot more memory, but at least it prevents you
// from needing to store a fallback JPG/PNG and the download size will still likely be smaller.
const alphaFormatPreference = [
  'ETC2_RGBA', 'BC7_M5_RGBA', 'BC3_RGBA', 'ASTC_4x4_RGBA', 'PVRTC1_4_RGBA', 'RGBA32'];
// eslint-disable-next-line no-unused-vars
const opaqueFormatPreference = [
  'ETC1_RGB', 'BC7_M5_RGBA', 'BC1_RGB', 'ETC2_RGBA', 'ASTC_4x4_RGBA', 'PVRTC1_4_RGB', 'RGB565', 'RGBA32'];

// TODO: There doesn't appear to be any limit on which of the many MANY VkFormats can be supported, so we'll need a
// plan for supporting as many as we can.
function vkFormatToGPUFormat(vkFormat) {
  switch (vkFormat) {
    case 0: // VK_FORMAT_UNDEFINED
      throw new Error(`Cannot decode if VkFormat is VK_FORMAT_UNDEFINED`);
    case 23: // VK_FORMAT_R8G8B8_UNORM
      return 'rgb8unorm';
    case 37: // VK_FORMAT_R8G8B8A8_UNORM
      return 'rgba8unorm';
    case 43: // VK_FORMAT_R8G8B8A8_SRGB
      return 'rgba8unorm-srgb';
    default:
      throw new Error(`Unsupported VkFormat: ${vkFormat}`);
  }
}

// TODO: Expand this list too.
function glFormatToGPUFormat(glInternalFormat) {
  switch (glInternalFormat) {
    case 0: // GL_NONE
      throw new Error(`Cannot decode if glInternalFormat is GL_NONE`);
    case 0x8051: // GL_RGB8
      return 'rgb8unorm';
    case 0x8058: // GL_RGBA8
      return 'rgba8unorm';
    case 0x8C41: // SRGB8
      return 'rgb8unorm-srgb';
    case 0x8C43: // SRGB8_ALPHA8
      return 'rgba8unorm-srgb';
    default:
      throw new Error(`Unsupported glInternalFormat: ${glInternalFormat}`);
  }
}

function getTextureType(ktxTexture) {
  if (ktxTexture.baseDepth > 1) {
    return '3d';
  } else if (ktxTexture.isCubemap) {
    if (ktxTexture.isArray) {
      return 'cube-array';
    }
    return 'cube';
  } else if (ktxTexture.isArray) {
    return '2d-array';
  }
  return '2d';
}

async function parseFile(buffer, supportedFormats, mipmaps) {
  const ktx = await KTX_INITIALIZED;

  // eslint-disable-next-line new-cap
  const ktxTexture = new ktx.ktxTexture(new Uint8Array(buffer));

  let format;
  if (ktxTexture.needsTranscoding) {
    let transcodeFormat;
    // eslint-disable-next-line guard-for-in
    for (const targetFormat of alphaFormatPreference) {
      const wttFormat = WTT_FORMAT_MAP[targetFormat];
      if (supportedFormats.indexOf(wttFormat.format) > -1) {
        format = wttFormat.format;
        transcodeFormat = ktx.TranscodeTarget[targetFormat];
        break;
      }
    }

    if (!transcodeFormat) {
      throw new Error('No appropriate transcode format found.');
    }

    const result = ktxTexture.transcodeBasis(transcodeFormat, 0);
    if (result != ktx.ErrorCode.SUCCESS) {
      throw new Error('Unable to transcode basis texture.');
    }
  } else {
    if (ktxTexture.classId == 2) { // KTX2 texture
      format = vkFormatToGPUFormat(ktxTexture.vkFormat);
      if (supportedFormats.indexOf(format) == -1) {
        throw new Error(`Texture stored in unsupported format: ${format}`);
      }
    } else if (ktxTexture.classId == 1) { // KTX texture
      format = glFormatToGPUFormat(ktxTexture.glInternalformat);
      if (supportedFormats.indexOf(format) == -1) {
        throw new Error(`Texture stored in unsupported format: ${format}`);
      }
    }
  }

  if (!format) {
    throw new Error('Unable to identify texture format.');
  }

  const type = getTextureType(ktxTexture);

  const textureData = new WorkerTextureData({
    format,
    type,
    width: ktxTexture.baseWidth,
    height: ktxTexture.baseHeight,
    depth: ktxTexture.baseDepth,
  });

  // Transcode each mip level of each image.
  for (let level = 0; level < ktxTexture.numLevels; ++level) {
    const textureLevel = textureData.getLevel(level);

    for (let layer = 0; layer < ktxTexture.numLayers; ++layer) {
      for (let face = 0; face < ktxTexture.numFaces; ++face) {
        const sliceIndex = (layer * ktxTexture.numFaces) + face;
        const imageData = ktxTexture.getImageData(level, layer, face);

        // Copy to a new Uint8Array for transfer.
        const levelData = new Uint8Array(imageData.byteLength);
        levelData.set(imageData);
        textureLevel.setSlice(sliceIndex, levelData);
      }
    }
  }

  ktxTexture.delete();

  return textureData;
}

onmessage = createTextureMessageHandler(parseFile);
