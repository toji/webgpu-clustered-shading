/**
 * @file Utilites common to all worker-based loaders
 * @module WorkerUtil
 */

/**
 * Notifies the main thread when transcoding a texture has failed to load for any reason.
 *
 * @param {number} id - Identifier for the texture being transcoded.
 * @param {string} errorMsg - Description of the error that occured
 * @returns {void}
 */
function textureLoadFail(id, errorMsg) {
  postMessage({
    id: id,
    error: errorMsg,
  });
}

function createTextureMessageHandler(onBufferReady) {
  return async (msg) => {
    const url = msg.data.url; // The URL of the basis image OR
    const id = msg.data.id; // A unique ID for the texture
    let buffer = msg.data.buffer; // An array buffer with the file data

    if (url) {
      // Make the call to fetch the file data
      const response = await fetch(url);
      if (!response.ok) {
        return textureLoadFail(id, `Fetch failed: ${response.status}, ${response.statusText}`);
      }
      buffer = await response.arrayBuffer();
    }

    if (!buffer) {
      return textureLoadFail(id, `No url or buffer specified`);
    }

    const supportedFormats = [...msg.data.supportedFormats];

    // Advertise formats that can be trivially transcoded to as supported as well.
    const transcoders = {};
    for (const transcodeDst in UNCOMPRESSED_TRANSCODERS) {
      if (supportedFormats.indexOf(transcodeDst) != -1) {
        const transcodeFunctions = UNCOMPRESSED_TRANSCODERS[transcodeDst];
        for (const transcodeSrc in transcodeFunctions) {
          if (supportedFormats.indexOf(transcodeSrc) == -1) {
            supportedFormats.push(transcodeSrc);
            transcoders[transcodeSrc] = {
              format: transcodeDst,
              function: transcodeFunctions[transcodeSrc],
            };
          }
        }
      }
    }

    try {
      // Should return a WorkerTextureData instance
      const result = await onBufferReady(
          buffer, // An array buffer with the file data
          supportedFormats, // The formats this device supports
          msg.data.mipmaps); // Wether or not mipmaps should be unpacked

      const transcode = transcoders[result.format];
      if (transcode) {
        result.transcode(transcode.format, transcode.function);
      }

      result.transfer(id);
    } catch (err) {
      textureLoadFail(id, err.message);
    }
  };
}

const DEFAULT_TEXTURE_DATA_OPTIONS = {
  format: 'rgba8unorm',
  type: '2d',
  width: 1,
  height: 1,
  depth: 1,
  imageData: null,
  imageDataOptions: {},
};

class WorkerTextureData {
  constructor(textureDataOptions) {
    const options = Object.assign({}, DEFAULT_TEXTURE_DATA_OPTIONS, textureDataOptions);

    this.format = options.format;
    this.type = options.type;
    this.width = Math.max(1, options.width);
    this.height = Math.max(1, options.height);

    if (options.type == '3d' || options.type == '2d-array') {
      this.depth = Math.max(1, options.depth);
    } else if (options.type == 'cube') {
      this.depth = 6;
    } else if (options.type == '2d') {
      this.depth = 1;
    }

    this.levels = [];
    this.bufferSet = new Set();

    // Optionally, data for the first image's first mip level can be passed to the constructor to handle simple cases.
    if (options.imageData) {
      this.getLevel(0).setSlice(0, options.imageData, options.imageDataOptions);
    }
  }

  getLevel(index, options = {}) {
    let level = this.levels[index];
    if (!level) {
      level = new WorkerTextureLevelData(this, index, options);
      this.levels[index] = level;
    }
    return level;
  }

  transcode(format, fn) {
    for (const level of this.levels) {
      for (const slice of level.slices) {
        fn(slice);
      }
    }
    this.format = format;
  }

  transfer(id) {
    const levelList = [];
    for (const level of this.levels) {
      levelList.push({
        levelIndex: level.levelIndex,
        width: level.width,
        height: level.height,
        depth: level.depth,
        slices: level.slices
      });
    }
    postMessage({
      id,
      format: this.format,
      type: this.type,
      width: this.width,
      height: this.height,
      depth: this.depth,
      levels: levelList,
    }, this.bufferSet.values());
  }
}

class WorkerTextureLevelData {
  constructor(textureData, levelIndex, options) {
    this.textureData = textureData;
    this.levelIndex = levelIndex;
    this.width = Math.max(1, options.width || this.textureData.width >> levelIndex);
    this.height = Math.max(1, options.height || this.textureData.height >> levelIndex);

    if (textureData.type == '3d') {
      this.depth = Math.max(1, options.depth || this.textureData.depth >> levelIndex);
    } else if (textureData.type == '2d-array') {
      this.depth = this.textureData.depth;
    } else if (textureData.type == 'cube') {
      this.depth = 6;
    } else if (textureData.type == '2d') {
      this.depth = 1;
    }

    this.slices = [];
  }

  setSlice(sliceIndex, bufferOrTypedArray, options = {}) {
    if (this.slices[sliceIndex] != undefined) {
      throw new Error('Cannot define an image slice twice.');
    }

    let byteOffset = options.byteOffset || 0;
    let byteLength = options.byteLength || 0;

    let buffer;
    if (bufferOrTypedArray instanceof ArrayBuffer) {
      buffer = bufferOrTypedArray;
      if (!byteLength) {
        byteLength = buffer.byteLength - byteOffset;
      }
    } else {
      buffer = bufferOrTypedArray.buffer;
      if (!byteLength) {
        byteLength = bufferOrTypedArray.byteLength - byteOffset;
      }
      byteOffset += bufferOrTypedArray.byteOffset;
    }

    this.textureData.bufferSet.add(buffer);

    this.slices[sliceIndex] = {
      sliceIndex,
      buffer,
      byteOffset,
      byteLength,
    };
  }
}

// Uncompressed transcoders
// There's a few formats that are trivial to transcode between and help patch up common formats that are missing from
// either WebGL or WebGPU. Transcoders that result in quality loss or which decompress a compressed format SHOULD NOT be
// added here. Swizzling, unpacking, or adding a missing channel are all fair game.

function rgb8ToRgba8(slice) {
  const pixelCount = slice.byteLength / 3;
  const src = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
  const dst = new Uint32Array(pixelCount);


  for (let i = 0; i < pixelCount; ++i) {
    /* eslint-disable no-multi-spaces */
    dst[i] = (src[i*3]) +         // R
             (src[i*3+1] << 8) +  // G
             (src[i*3+2] << 16) + // B
             0xff000000;          // A (Always 255)
    /* eslint-enable */
  }

  slice.buffer = dst.buffer;
  slice.byteOffset = dst.byteOffset;
  slice.byteLength = dst.byteLength;
};

// Transcoders are listed as { 'destination format': { 'source format': fn(), 'source_format2': fn()... } }
// Destinations formats should be listed in order of preference.
const UNCOMPRESSED_TRANSCODERS = {
  'rgba8unorm': {
    'bgra8unorm': (slice) => {
      // Because the buffer size stays the same we can do the swizzle in place.
      const pixelCount = slice.byteLength / 4;
      const px = new Uint32Array(slice.buffer, slice.byteOffset, pixelCount);
      for (let i = 0; i < pixelCount; ++i) {
        const bgra = px[i];
        px[i] = (bgra & 0xff00ff00) +
                ((bgra & 0xff0000) >> 16) +
                ((bgra & 0xff) << 16);
      }
    },

    'rgb8unorm': rgb8ToRgba8,
  },

  'rgba8unorm-srgb': {
    'rgb8unorm-srgb': rgb8ToRgba8,
  }
};
