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
 * Supports loading textures for WebGPU, as well as providing common utilities that are not part of the core WebGPU API
 * such as mipmap generation.
 *
 * @file WebGPU client for the Web Texture Tool
 * @module WebGPUTextureTool
 */

import {WebTextureFormat, WebTextureTool, WebTextureResult} from './web-texture-tool-base.js';
import {WebGPUMipmapGenerator} from './webgpu-mipmap-generator.js';

const IMAGE_BITMAP_SUPPORTED = (typeof createImageBitmap !== 'undefined');

const EXTENSION_FORMATS = {
  'texture-compression-bc': [
    'bc1-rgba-unorm',
    'bc2-rgba-unorm',
    'bc3-rgba-unorm',
    'bc7-rgba-unorm',
  ],
  'textureCompressionBC': [ // Non-standard
    'bc1-rgba-unorm',
    'bc2-rgba-unorm',
    'bc3-rgba-unorm',
    'bc7-rgba-unorm',
  ],
};

/**
 * Determines the number of mip levels needed for a full mip chain given the width and height of texture level 0.
 *
 * @param {number} width of texture level 0.
 * @param {number} height of texture level 0.
 * @returns {number} Ideal number of mip levels.
 */
function calculateMipLevels(width, height) {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/**
 * Texture Client that interfaces with WebGPU.
 */
class WebGPUTextureClient {
  /**
   * Creates a WebTextureClient instance which uses WebGPU.
   * Should not be called outside of the WebGLTextureTool constructor.
   *
   * @param {module:External.GPUDevice} device - WebGPU device to use.
   */
  constructor(device) {
    this.device = device;
    this.allowCompressedFormats = true;

    this.uncompressedFormatList = [
      'rgba8unorm',
      'rgba8unorm-srgb',
      'bgra8unorm',
      'bgra8unorm-srgb',
    ];

    this.supportedFormatList = [
      'rgba8unorm',
      'rgba8unorm-srgb',
      'bgra8unorm',
      'bgra8unorm-srgb',
    ];

    // Add any other formats that are exposed by extensions.
    if (device.extensions) {
      for (const extension of device.extensions) {
        const formats = EXTENSION_FORMATS[extension];
        if (formats) {
          this.supportedFormatList.push(...formats);
        }
      }
    }

    this.mipmapGenerator = new WebGPUMipmapGenerator(device);
  }

  /**
   * Returns a list of the WebTextureFormats that this client can support.
   *
   * @returns {Array<module:WebTextureTool.WebTextureFormat>} - List of supported WebTextureFormats.
   */
  supportedFormats() {
    if (this.allowCompressedFormats) {
      return this.supportedFormatList;
    } else {
      return this.uncompressedFormatList;
    }
  }

  /**
   * Creates a GPUTexture from the given ImageBitmap.
   *
   * @param {module:External.ImageBitmap} imageBitmap - ImageBitmap source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  async textureFromImageBitmap(imageBitmap, format, generateMipmaps) {
    if (!this.device) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }
    const mipLevelCount = generateMipmaps ? calculateMipLevels(imageBitmap.width, imageBitmap.height) : 1;

    const usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED;

    const textureDescriptor = {
      size: {width: imageBitmap.width, height: imageBitmap.height, depth: 1},
      format,
      usage,
      mipLevelCount,
    };
    const texture = this.device.createTexture(textureDescriptor);

    this.device.defaultQueue.copyImageBitmapToTexture({imageBitmap}, {texture}, textureDescriptor.size);

    if (generateMipmaps) {
      this.mipmapGenerator.generateMipmap(texture, textureDescriptor);
    }

    return new WebTextureResult(texture, {
      width: imageBitmap.width,
      height: imageBitmap.height,
      mipLevels: mipLevelCount,
      format: format,
    });
  }

  /**
   * Creates a GPUTexture from the given HTMLImageElement.
   * Note that WebGPU cannot consume image elements directly, so this method will attempt to create an ImageBitmap and
   * pass that to textureFromImageBitmap instead.
   *
   * @param {module:External.HTMLImageElement} image - image source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  async textureFromImageElement(image, format, generateMipmaps) {
    if (!this.device) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }
    if (!IMAGE_BITMAP_SUPPORTED) {
      throw new Error('Must support ImageBitmap to use WebGPU. (How did you even get to this error?)');
    }
    const imageBitmap = await createImageBitmap(image);
    return this.textureFromImageBitmap(imageBitmap, format, generateMipmaps);
  }

  /**
   * Creates a GPUTexture from the given texture level data.
   *
   * @param {module:WebTextureTool.WebTextureData} textureData - Object containing data and layout for each image and
   * mip level of the texture.
   * @param {boolean} generateMipmaps - True if mipmaps generation is desired. Only applies if a single level is given
   * and the texture format is renderable.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromTextureData(textureData, generateMipmaps) {
    if (!this.device) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const wtFormat = WebTextureFormat[textureData.format];
    if (!wtFormat) {
      throw new Error(`Unknown format "${textureData.format}"`);
    }

    const blockInfo = wtFormat.compressed || {blockBytes: 4, blockWidth: 1, blockHeight: 1};
    generateMipmaps = generateMipmaps && wtFormat.canGenerateMipmaps;

    const mipLevelCount = textureData.levels.length > 1 ? textureData.levels.length :
                            (generateMipmaps ? calculateMipLevels(textureData.width, textureData.height) : 1);

    const usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED;

    const textureDescriptor = {
      size: {
        width: Math.ceil(textureData.width / blockInfo.blockWidth) * blockInfo.blockWidth,
        height: Math.ceil(textureData.height / blockInfo.blockHeight) * blockInfo.blockHeight,
        depth: textureData.depth,
      },
      format: textureData.format,
      usage,
      mipLevelCount: mipLevelCount,
    };
    const texture = this.device.createTexture(textureDescriptor);

    for (const mipLevel of textureData.levels) {
      const bytesPerRow = Math.ceil(mipLevel.width / blockInfo.blockWidth) * blockInfo.blockBytes;

      for (const slice of mipLevel.slices) {
        // TODO: It may be more efficient to upload the mip levels to a buffer and copy to the texture, but this makes
        // the code significantly simpler and avoids an alignment issue I was seeing previously, so for now we'll take
        // the easy route.
        this.device.defaultQueue.writeTexture(
            {
              texture: texture,
              mipLevel: mipLevel.levelIndex,
              origin: {z: slice.sliceIndex},
            },
            slice.buffer,
            {
              offset: slice.byteOffset,
              bytesPerRow,
            },
            { // Copy width and height must be a multiple of the format block size;
              width: Math.ceil(mipLevel.width / blockInfo.blockWidth) * blockInfo.blockWidth,
              height: Math.ceil(mipLevel.height / blockInfo.blockHeight) * blockInfo.blockHeight,
              depth: 1,
            });
      }
    }

    if (generateMipmaps) {
      this.mipmapGenerator.generateMipmap(texture, textureDescriptor);
    }

    return new WebTextureResult(texture, {
      width: textureData.width,
      height: textureData.height,
      depth: textureData.depth,
      mipLevels: mipLevelCount,
      format: textureData.format,
      type: textureData.type,
    });
  }

  /**
   * Destroy this client.
   * The client is unusable after calling destroy().
   *
   * @returns {void}
   */
  destroy() {
    this.device = null;
  }
}

/**
 * Variant of WebTextureTool which produces WebGPU textures.
 */
export class WebGPUTextureTool extends WebTextureTool {
  /**
   * Creates a WebTextureTool instance which produces WebGPU textures.
   *
   * @param {module:External.GPUDevice} device - WebGPU device to create textures with.
   * @param {object} toolOptions - Options to initialize this WebTextureTool instance with.
   */
  constructor(device, toolOptions) {
    super(new WebGPUTextureClient(device), toolOptions);
  }
}
