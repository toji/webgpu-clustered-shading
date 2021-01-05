// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/**
 * This library offers a unified way of loading textures for both WebGL and WebGPU from various file formats, and in all
 * cases attempts to handle the loading as efficently as possible. Every effort made to prevent texture loading from
 * blocking the main thread, since that can often be one of the primary causes of jank during page startup or while
 * streaming in new assets.
 *
 * @file Library for loading various image sources as textures for WebGL or WebGPU
 * @module WebTextureTool
 */

import {ImageLoader} from './image-loader.js';
import {WorkerLoader} from './workers/worker-loader.js';

// For access to WebGL enums without a context.
const GL = WebGLRenderingContext;

/**
 * Texture Format
 *
 * @typedef {string} WebTextureFormat
 */

// Additional format data used by Web Texture Tool, based off WebGPU formats.
// WebGL equivalents given where possible.
export const WebTextureFormat = {
  // Uncompressed formats
  'rgb8unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGB, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8051}, // RGB8
  },
  'rgba8unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8058}, // RGBA8
  },
  'rgb8unorm-srgb': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGB, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8C40}, // SRGB8
  },
  'rgba8unorm-srgb': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8C43}, // SRGB8_ALPHA8
  },
  'rgb565unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGB, type: GL.UNSIGNED_SHORT_5_6_5, sizedFormat: GL.RGB565},
  },
  'rgba4unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_SHORT_4_4_4_4, sizedFormat: GL.RGBA4},
  },
  'rgba5551unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_SHORT_5_5_5_1, sizedFormat: GL.RGB5_A1},
  },

  'bgra8unorm': {canGenerateMipmaps: true}, // No WebGL equivalent
  'bgra8unorm-srgb': {canGenerateMipmaps: true}, // No WebGL equivalent

  // Compressed formats
  // WebGL enums from http://www.khronos.org/registry/webgl/extensions/
  'bc1-rgb-unorm': {
    gl: {texStorage: true, sizedFormat: 0x83F0}, // COMPRESSED_RGB_S3TC_DXT1_EXT
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
  'bc2-rgba-unorm': {
    gl: {texStorage: true, sizedFormat: 0x83F2}, // COMPRESSED_RGBA_S3TC_DXT3_EXT
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'bc3-rgba-unorm': {
    gl: {texStorage: false, sizedFormat: 0x83F3}, // COMPRESSED_RGBA_S3TC_DXT5_EXT
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'bc7-rgba-unorm': {
    gl: {texStorage: true, sizedFormat: 0x8E8C}, // COMPRESSED_RGBA_BPTC_UNORM_EXT
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'etc1-rgb-unorm': {
    gl: {texStorage: false, sizedFormat: 0x8D64}, // COMPRESSED_RGB_ETC1_WEBGL
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
  'etc2-rgba8unorm': {
    gl: {texStorage: true, sizedFormat: 0x9278}, // COMPRESSED_RGBA8_ETC2_EAC
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'astc-4x4-rgba-unorm': {
    gl: {texStorage: true, sizedFormat: 0x93B0}, // COMPRESSED_RGBA_ASTC_4x4_KHR
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'pvrtc1-4bpp-rgb-unorm': {
    gl: {texStorage: false, sizedFormat: 0x8C00}, // COMPRESSED_RGB_PVRTC_4BPPV1_IMG
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
  'pvrtc1-4bpp-rgba-unorm': {
    gl: {texStorage: false, sizedFormat: 0x8C02}, // COMPRESSED_RGBA_PVRTC_4BPPV1_IMG
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
};

/**
 * Texture result from calling one of the WebTextureTool methods
 *
 * @property {(module:External.WebGLTexture|module:External.GPUTexture)} texture - WebGL or WebGPU texture object.
 * @property {number} width of mip level 0 in pixels.
 * @property {number} height of mip level 0 in pixels.
 * @property {number} depth of mip level 0 in pixels.
 * @property {number} mipLevels - Number of mip levels the texture contains.
 * @property {WebTextureFormat} format - Format of the texture.
 */
export class WebTextureResult {
  /**
   * Create an instance of a WebTextureResult.
   *
   * @param {(module:External.WebGLTexture|module:External.GPUTexture)} texture - WebGL or WebGPU texture object.
   * @param {number} width of mip level 0 in pixels.
   * @param {number} height of mip level 0 in pixels.
   * @param {number} depth of mip level 0 in pixels.
   * @param {number} mipLevels - Number of mip levels the texture contains.
   * @param {WebTextureFormat} format - Format of the texture.
   */
  constructor(texture, description = {}) {
    this.texture = texture;
    this.width = description.width || 1;
    this.height = description.height || 1;
    this.depth = description.depth || 1;
    this.mipLevels = description.mipLevels || 1;
    this.format = description.format || 'rgba8unorm';
    this.type = description.type || '2d';
  }
}

export class WebTextureData {
  constructor(format, width, height, imageData = null, imageDataOptions = {}) {
    this.format = format;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.levels = [];

    // Optionally, data for the first image's first mip level can be passed to the constructor to handle simple cases.
    if (imageData) {
      this.getLevel(0).setSlice(0, imageData, imageDataOptions);
    }
  }

  getLevel(index, options = {}) {
    let level = this.levels[index];
    if (!level) {
      level = new WebTextureLevelData(this, index, options);
      this.levels[index] = level;
    }
    return level;
  }
}

class WebTextureLevelData {
  constructor(textureData, levelIndex, options) {
    this.textureData = textureData;
    this.levelIndex = levelIndex;
    this.width = Math.max(1, options.width || this.textureData.width >> levelIndex);
    this.height = Math.max(1, options.height || this.textureData.height >> levelIndex);
    this.slices = [];
  }

  setSlice(index, bufferOrTypedArray, options = {}) {
    if (this.slices[index] != undefined) {
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

    this.slices[index] = {
      buffer,
      byteOffset,
      byteLength,
    };
  }
}

/**
 * Associates a set of extensions with a specifc loader.
 */
class ExtensionHandler {
  /**
   * Creates an ExtensionHandler.
   *
   * @param {Array<string>} extensions - List of extensions that this loader can handle.
   * @param {Function} callback - Callback which returns an instance of the loader.
   */
  constructor(mimeTypes, callback) {
    this.mimeTypes = mimeTypes;
    this.callback = callback;
    this.loader = null;
  }

  /**
   * Gets the loader associated with this extension set. Creates an instance by calling the callback if one hasn't been
   * instantiated previously.
   *
   * @returns {object} Texture Loader instance.
   */
  getLoader() {
    if (!this.loader) {
      this.loader = this.callback();
    }
    return this.loader;
  }
}

const EXTENSION_MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  apng: 'image/apng',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  svg: 'image/svg+xml',
  basis: 'image/basis',
  ktx: 'image/ktx',
  ktx2: 'image/ktx2',
  dds: 'image/vnd.ms-dds',
};

const EXTENSION_HANDLERS = [
  new ExtensionHandler(ImageLoader.supportedMIMETypes(), () => new ImageLoader()),
  new ExtensionHandler(['image/basis'], () => new WorkerLoader('basis/basis-worker.js')),
  new ExtensionHandler(['image/ktx', 'image/ktx2'], () => new WorkerLoader('ktx/ktx-worker.js')),
  new ExtensionHandler(['image/vnd.ms-dds'], () => new WorkerLoader('dds-worker.js')),
];

const CLIENT = Symbol('wtt/WebTextureClient');
const LOADERS = Symbol('wtt/WebTextureLoaders');

const TMP_ANCHOR = document.createElement('a');
const IMAGE_BITMAP_SUPPORTED = (typeof createImageBitmap !== 'undefined');

const DEFAULT_URL_OPTIONS = {
  extension: null,
  mipmaps: true,
};

function getMimeTypeLoader(wtt, mimeType) {
  if (!mimeType) {
    throw new Error('A valid MIME type must be specified.');
  }

  let typeHandler = wtt[LOADERS][mimeType];
  if (!typeHandler) {
    typeHandler = wtt[LOADERS]['*'];
  }

  // Get the appropriate loader for the extension. Will instantiate the loader instance the first time it's
  // used.
  const loader = typeHandler.getLoader();
  if (!loader) {
    throw new Error(`Failed to get loader for MIME type "${mimeType}"`);
  }
  return loader;
}

/**
 * Base texture tool class.
 * Must not be used directly, create an instance of WebGLTextureTool or WebGPUTextureTool instead.
 */
export class WebTextureTool {
  /**
   * WebTextureTool constructor. Must not be called by applications directly.
   * Create an instance of WebGLTextureTool or WebGPUTextureTool as needed instead.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   */
  constructor(client) {
    this[CLIENT] = client;
    this[LOADERS] = {};

    // Map every available extension to it's associated handler
    for (const extensionHandler of EXTENSION_HANDLERS) {
      for (const mimeType of extensionHandler.mimeTypes) {
        this[LOADERS][mimeType] = extensionHandler;
      }
    }

    // Register one last "fallback" extension. Anything that we receive that has an unrecognized extension will try to
    // load with the ImageTextureLoader.
    this[LOADERS]['*'] = EXTENSION_HANDLERS[0];
  }

  /** Loads a texture from the given URL
   *
   * @param {string} url - URL of the file to load.
   * @param {object} textureOptions - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - Promise which resolves to the completed WebTextureResult.
   */
  async loadTextureFromUrl(url, textureOptions) {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const options = Object.assign({}, DEFAULT_URL_OPTIONS, textureOptions);

    // Use this to resolve to a full URL.
    TMP_ANCHOR.href = url;

    // If an explicit extension wasn't provided, examine the URL to determine one.
    if (!options.mimeType) {
      // Isolate just the pathname from the given URL, then split the extension off of that.
      const extIndex = TMP_ANCHOR.pathname.lastIndexOf('.');
      const extension = extIndex > -1 ? TMP_ANCHOR.pathname.substring(extIndex+1).toLowerCase() : '*';
      options.mimeType = EXTENSION_MIME_TYPES[extension];
    }

    const loader = getMimeTypeLoader(this, options.mimeType);
    return loader.loadTextureFromUrl(this[CLIENT], TMP_ANCHOR.href, options);
  }

  /** Loads a texture from the given blob
   *
   * @param {Blob} blob - Blob containing the texture file data.
   * @param {object} textureOptions - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - Promise which resolves to the completed WebTextureResult.
   */
  async loadTextureFromBlob(blob, textureOptions) {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const options = Object.assign({}, DEFAULT_URL_OPTIONS, textureOptions);

    const loader = getMimeTypeLoader(this, blob.type);
    return loader.loadTextureFromBlob(this[CLIENT], blob, options);
  }

  /** Loads a texture from the given blob
   *
   * @param {ArrayBuffer|ArrayBufferView} buffer - Buffer containing the texture file data.
   * @param {object} textureOptions - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - Promise which resolves to the completed WebTextureResult.
   */
  async loadTextureFromBuffer(buffer, textureOptions) {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const options = Object.assign({}, DEFAULT_URL_OPTIONS, textureOptions);

    if (!options.mimeType && options.filename) {
      const extIndex = options.filename.lastIndexOf('.');
      const extension = extIndex > -1 ? options.filename.substring(extIndex+1).toLowerCase() : null;
      options.mimeType = EXTENSION_MIME_TYPES[extension];
    }

    const loader = getMimeTypeLoader(this, options.mimeType);
    return loader.loadTextureFromBuffer(this[CLIENT], buffer, options);
  }

  /** Loads a texture from the given image element.
   *
   * @param {Element} element - HTML element (img, canvas, video, etc) to load as a texture.
   * @param {object} textureOptions - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - Promise which resolves to the completed WebTextureResult.
   */
  async loadTextureFromElement(element, textureOptions) {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const options = Object.assign({}, DEFAULT_URL_OPTIONS, textureOptions);

    if (!IMAGE_BITMAP_SUPPORTED) {
      return this[CLIENT].textureFromImageElement(element, 'rgba8unorm', options.mipmaps);
    }
    const imageBitmap = await createImageBitmap(element);
    return this[CLIENT].textureFromImageBitmap(imageBitmap, 'rgba8unorm', options.mipmaps);
  }

  /** Loads a texture from the given image bitmap.
   *
   * @param {ImageBitmap} imageBitmap - Image bitmap to load as a texture.
   * @param {object} textureOptions - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - Promise which resolves to the completed WebTextureResult.
   */
  async loadTextureFromImageBitmap(imageBitmap, textureOptions) {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const options = Object.assign({}, DEFAULT_URL_OPTIONS, textureOptions);
    return this[CLIENT].textureFromImageBitmap(imageBitmap, 'rgba8unorm', options.mipmaps);
  }

  /**
   * Creates a 1x1 texture with the specified color.
   *
   * @param {number} r - Red channel value
   * @param {number} g - Green channel value
   * @param {number} b - Blue channel value
   * @param {number} [a=1.0] - Alpha channel value
   * @param {WebTextureFormat} [format='rgba8unorm'] - Format to create the texture with
   * @returns {WebTextureResult} - Completed WebTextureResult
   */
  createTextureFromColor(r, g, b, a = 1.0, format = 'rgba8unorm') {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }
    if (format != 'rgba8unorm' && format != 'rgba8unorm-srgb') {
      throw new Error('createTextureFromColor only supports "rgba8unorm" and "rgba8unorm-srgb" formats');
    }
    const data = new Uint8Array([r * 255, g * 255, b * 255, a * 255]);
    return this[CLIENT].textureFromTextureData(new WebTextureData(format, 1, 1, data), false);
  }

  /**
   * Sets whether or not compressed formats should be loaded.
   * If `false` and a compressed texture can be transcoded to an uncompressed format it will be, otherwise it will be
   * rejected.
   *
   * @param {boolean} value - `true` if compressed formats should be loaded.
   */
  set allowCompressedFormats(value) {
    this[CLIENT].allowCompressedFormats = !!value;
  }

  /**
   * Returns whether or not compressed formats should be loaded.
   *
   * @returns {boolean} `true` if compressed formats should be loaded.
   */
  get allowCompressedFormats() {
    return this[CLIENT].allowCompressedFormats;
  }

  /**
   * Destroys the texture tool and stops any in-progress texture loads that have been started.
   *
   * @returns {void}
   */
  destroy() {
    if (this[CLIENT]) {
      this[CLIENT].destroy();
      this[CLIENT] = null;

      // TODO: Should this happen?
      // Would have to make sure every instance had it's own copies of the loaders.
      // Shut down every loader that this class has initialized.
      /*
      for (const extensionHandler of this[LOADERS]) { // Doesn't work
        if (extensionHandler.loader) {
          extensionHandler.loader.destroy();
          extensionHandler.loader = null;
        }
      }
      */
    }
  }
}
