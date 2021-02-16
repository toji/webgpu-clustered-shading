/**
 * @file Web Worker for loading/transcoding DirectDraw Surface (DDS) texture files
 * @module DDSWorker
 */

importScripts('./worker-util.js');

// All values and structures referenced from:
// http://msdn.microsoft.com/en-us/library/bb943991.aspx/
const DDS_MAGIC = 0x20534444;

const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PITCH = 0x8;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_MIPMAPCOUNT = 0x20000;
const DDSD_LINEARSIZE = 0x80000;
const DDSD_DEPTH = 0x800000;

const DDSCAPS_COMPLEX = 0x8;
const DDSCAPS_MIPMAP = 0x400000;
const DDSCAPS_TEXTURE = 0x1000;

const DDSCAPS2_CUBEMAP = 0x200;
const DDSCAPS2_CUBEMAP_POSITIVEX = 0x400;
const DDSCAPS2_CUBEMAP_NEGATIVEX = 0x800;
const DDSCAPS2_CUBEMAP_POSITIVEY = 0x1000;
const DDSCAPS2_CUBEMAP_NEGATIVEY = 0x2000;
const DDSCAPS2_CUBEMAP_POSITIVEZ = 0x4000;
const DDSCAPS2_CUBEMAP_NEGATIVEZ = 0x8000;
const DDSCAPS2_VOLUME = 0x200000;

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_ALPHA = 0x2;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_YUV = 0x200;
const DDPF_LUMINANCE = 0x20000;

/**
 * @param value
 */
function fourCCToInt32(value) {
  return value.charCodeAt(0) +
        (value.charCodeAt(1) << 8) +
        (value.charCodeAt(2) << 16) +
        (value.charCodeAt(3) << 24);
}

/**
 * @param value
 */
function int32ToFourCC(value) {
  return String.fromCharCode(
      value & 0xff,
      (value >> 8) & 0xff,
      (value >> 16) & 0xff,
      (value >> 24) & 0xff,
  );
}

const FOURCC_DXT1 = fourCCToInt32('DXT1');
const FOURCC_DXT3 = fourCCToInt32('DXT3');
const FOURCC_DXT5 = fourCCToInt32('DXT5');
const FOURCC_ETC1 = fourCCToInt32('ETC1');

const headerLengthInt = 31; // The header length in 32 bit ints

// Offsets into the header array
const off_magic = 0;

const off_size = 1;
const off_flags = 2;
const off_height = 3;
const off_width = 4;

const off_mipmapCount = 7;

const off_pfFlags = 20;
const off_pfFourCC = 21;
const off_RGBBitCount = 22;
const off_RBitMask = 23;
const off_GBitMask = 24;
const off_BBitMask = 25;
const off_ABitMask = 26;

// Little reminder for myself where the above values come from
/* DDS_PIXELFORMAT {
    int32 dwSize; // offset: 19
    int32 dwFlags;
    char[4] dwFourCC;
    int32 dwRGBBitCount;
    int32 dwRBitMask;
    int32 dwGBitMask;
    int32 dwBBitMask;
    int32 dwABitMask; // offset: 26
};

DDS_HEADER {
    int32 dwSize; // 1
    int32 dwFlags;
    int32 dwHeight;
    int32 dwWidth;
    int32 dwPitchOrLinearSize;
    int32 dwDepth;
    int32 dwMipMapCount; // offset: 7
    int32[11] dwReserved1;
    DDS_PIXELFORMAT ddspf; // offset 19
    int32 dwCaps; // offset: 27
    int32 dwCaps2;
    int32 dwCaps3;
    int32 dwCaps4;
    int32 dwReserved2; // offset 31
};*/

/**
 * Transcodes DXT into RGB565.
 * Optimizations:
 * 1. Use integer math to compute c2 and c3 instead of floating point
 * math.  Specifically:
 * c2 = 5/8 * c0 + 3/8 * c1
 * c3 = 3/8 * c0 + 5/8 * c1
 * This is about a 40% performance improvement.  It also appears to
 * match what hardware DXT decoders do, as the colors produced
 * by this integer math match what hardware produces, while the
 * floating point in dxtToRgb565Unoptimized() produce slightly
 * different colors (for one GPU this was tested on).
 * 2. Unroll the inner loop.  Another ~10% improvement.
 * 3. Compute r0, g0, b0, r1, g1, b1 only once instead of twice.
 * Another 10% improvement.
 * 4. Use a Uint16Array instead of a Uint8Array.  Another 10% improvement.
 *
 * @author Evan Parker
 * @param {Uint16Array} src The src DXT bits as a Uint16Array.
 * @param {number} srcByteOffset
 * @param src16Offset
 * @param {number} width
 * @param {number} height
 * @returns {Uint16Array} dst
 */
function dxtToRgb565(src, src16Offset, width, height) {
  const c = new Uint16Array(4);
  const dst = new Uint16Array(width * height);
  const nWords = (width * height) / 4;
  let m = 0;
  let dstI = 0;
  let i = 0;
  let rb0 = 0; let g0 = 0; let rb1 = 0; let g1 = 0;

  const blockWidth = width / 4;
  const blockHeight = height / 4;
  for (let blockY = 0; blockY < blockHeight; blockY++) {
    for (let blockX = 0; blockX < blockWidth; blockX++) {
      i = src16Offset + 4 * (blockY * blockWidth + blockX);
      c[0] = src[i];
      c[1] = src[i + 1];
      rb0 = c[0] & 0xf81f;
      g0 = c[0] & 0x7e0;
      rb1 = c[1] & 0xf81f;
      g1 = c[1] & 0x7e0;
      // Interpolate between c0 and c1 to get c2 and c3.
      // Note that we approximate 1/3 as 3/8 and 2/3 as 5/8 for
      // speed. This also appears to be what the hardware DXT
      // decoder in many GPUs does :)
      c[2] = (((5 * rb0 + 3 * rb1) >> 3) & 0xf81f) |
                (((5 * g0 + 3 * g1) >> 3) & 0x7e0);
      c[3] = (((5 * rb1 + 3 * rb0) >> 3) & 0xf81f) |
                (((5 * g1 + 3 * g0) >> 3) & 0x7e0);
      m = src[i + 2];
      dstI = (blockY * 4) * width + blockX * 4;
      dst[dstI] = c[m & 0x3];
      dst[dstI + 1] = c[(m >> 2) & 0x3];
      dst[dstI + 2] = c[(m >> 4) & 0x3];
      dst[dstI + 3] = c[(m >> 6) & 0x3];
      dstI += width;
      dst[dstI] = c[(m >> 8) & 0x3];
      dst[dstI + 1] = c[(m >> 10) & 0x3];
      dst[dstI + 2] = c[(m >> 12) & 0x3];
      dst[dstI + 3] = c[(m >> 14)];
      m = src[i + 3];
      dstI += width;
      dst[dstI] = c[m & 0x3];
      dst[dstI + 1] = c[(m >> 2) & 0x3];
      dst[dstI + 2] = c[(m >> 4) & 0x3];
      dst[dstI + 3] = c[(m >> 6) & 0x3];
      dstI += width;
      dst[dstI] = c[(m >> 8) & 0x3];
      dst[dstI + 1] = c[(m >> 10) & 0x3];
      dst[dstI + 2] = c[(m >> 12) & 0x3];
      dst[dstI + 3] = c[(m >> 14)];
    }
  }
  return dst;
}

/**
 * Parses a DDS file from the given arrayBuffer and uploads it into the currently bound texture
 *
 * @param {WebGLRenderingContext} gl WebGL rendering context
 * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
 * @param {TypedArray} buffer Array Buffer containing the DDS files data
 * @param {boolean} [loadMipmaps] If false only the top mipmap level will be loaded, otherwise all available mipmaps will be uploaded
 *
 * @returns {number} Number of mipmaps uploaded, 0 if there was an error
 */
function parseFile(buffer, supportedFormats, mipmaps) {
  const header = new Int32Array(buffer, 0, headerLengthInt);

  if(header[off_magic] != DDS_MAGIC) {
    throw new Error('Invalid magic number in DDS header');
  }

  if(!header[off_pfFlags] & DDPF_FOURCC) {
    throw new Error('Unsupported format, must contain a FourCC code');
  }

  const fourCC = header[off_pfFourCC];
  let blockBytes = 0;
  let bytesPerPixel = 0;
  let internalFormat = 'unknown';
  switch(fourCC) {
    case FOURCC_DXT1:
      blockBytes = 8;
      internalFormat = 'bc1-rgb-unorm';
      break;

    case FOURCC_DXT3:
      blockBytes = 16;
      internalFormat = 'bc2-rgba-unorm';
      break;

    case FOURCC_DXT5:
      blockBytes = 16;
      internalFormat = 'bc3-rgba-unorm';
      break;

    case FOURCC_ETC1:
      blockBytes = 8;
      internalFormat = 'etc1-rgb-unorm';
      break;

    default: {
      const bitCount = header[off_RGBBitCount];
      const rBitMask = header[off_RBitMask];
      const gBitMask = header[off_GBitMask];
      const bBitMask = header[off_BBitMask];
      const aBitMask = header[off_ABitMask];

      if (bitCount === 32) {
        if (rBitMask & 0xff &&
            gBitMask & 0xff00 &&
            bBitMask & 0xff0000) {
          internalFormat = 'rgba8unorm';
          bytesPerPixel = 4;
        } else if (rBitMask & 0xff0000 &&
                   gBitMask & 0xff00 &&
                   bBitMask & 0xff) {
          internalFormat = 'bgra8unorm';
          bytesPerPixel = 4;
        }
      } else if (bitCount === 24) {
        if (rBitMask & 0xff0000 &&
            gBitMask & 0xff00 &&
            bBitMask & 0xff) {
          internalFormat = 'rgb8unorm';
          bytesPerPixel = 3;
        }
      }

      // TODO: A lot more possible formats to cover here.
    }
  }

  let width = header[off_width];
  let height = header[off_height];
  let dataOffset = header[off_size] + 4;

  if (supportedFormats.indexOf(internalFormat) == -1) {
    if (internalFormat === 'bc1-rgb-unorm' && supportedFormats.indexOf('rgb565unorm') != -1) {
      // Allow a fallback to rgb565 if it's bc1 and we don't support it natively.
      internalFormat = 'rgb565unorm';
      bytesPerPixel = 2;
      buffer = dxtToRgb565(new Uint16Array(buffer), dataOffset / 2, width, height).buffer;
      dataOffset = 0;
    } else {
      throw new Error(`Unsupported
       texture format: ${int32ToFourCC(fourCC)} ${internalFormat}`);
    }
  }

  if (blockBytes == 0) {
    return new WorkerTextureData({
      format: internalFormat, width, height,
      imageData: buffer,
      imageDataOptions: {
        byteOffset: dataOffset,
        byteLength: width * height * bytesPerPixel
      }
    });
  }

  let mipmapCount = 1;
  if(header[off_flags] & DDSD_MIPMAPCOUNT && mipmaps !== false) {
      mipmapCount = Math.max(1, header[off_mipmapCount]);
  }

  const textureData = new WorkerTextureData({format: internalFormat, width, height});
  for(let level = 0; level < mipmapCount; ++level) {
    const textureLevel = textureData.getLevel(level);
    const byteLength = blockBytes ? Math.max(4, width)/4 * Math.max(4, height)/4 * blockBytes :
                                    width * height * 4;

    textureLevel.setSlice(0, buffer, {
      byteOffset: dataOffset,
      byteLength
    });

    dataOffset += byteLength;
    width = Math.max(1, Math.ceil(width / 2));
    height = Math.max(1, Math.ceil(height / 2));
  }

  return textureData;
}

onmessage = createTextureMessageHandler(parseFile);
