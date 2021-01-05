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
 * Supports loading textures for both WebGL and WebGL 2.0
 *
 * @file WebGL client for the Web Texture Tool
 * @module WebGLTextureTool
 */

import {WebTextureFormat, WebTextureTool, WebTextureResult} from './web-texture-tool-base.js';

// For access to WebGL enums without a context.
const GL = WebGLRenderingContext;

/**
 * Determines if the given value is a power of two.
 *
 * @param {number} n - Number to evaluate.
 * @returns {boolean} - True if the number is a power of two.
 */
function isPowerOfTwo(n) {
  return (n & (n - 1)) === 0;
}

/**
 * Determines the number of mip levels needed for a full mip chain given the width and height of texture level 0.
 *
 * @param {number} width of texture level 0.
 * @param {number} height of texture level 0.
 * @returns {number} - Ideal number of mip levels.
 */
function calculateMipLevels(width, height) {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/**
 * Returns the associated WebGL values for the given mapping, if they exist.
 *
 * @param {module:WebTextureTool.WebTextureFormat} format - Texture format string.
 * @returns {WebGLMappedFormat} - WebGL values that correspond with the given format.
 */
function resolveFormat(format) {
  const wtFormat = WebTextureFormat[format];
  if (!wtFormat || !wtFormat.gl) {
    throw new Error(`No matching WebGL format for "${format}"`);
  }

  return wtFormat;
}

function webTextureTypeToGLTarget(type) {
  switch (type) {
    case 'cube':
      return GL.TEXTURE_CUBE_MAP;
    case '2d':
    default:
      return GL.TEXTURE_2D;
  }
}

/**
 * Variant of WebTextureClient that uses WebGL.
 */
class WebGLTextureClient {
  /**
   * Creates a WebTextureClient instance which uses WebGL.
   * Should not be called outside of the WebGLTextureTool constructor.
   *
   * @param {(module:External.WebGLRenderingContext|module:External.WebGL2RenderingContext)} gl - WebGL context to use.
   */
  constructor(gl) {
    this.gl = gl;
    this.isWebGL2 = this.gl instanceof WebGL2RenderingContext;
    this.allowCompressedFormats = true;

    // Compressed Texture Extensions
    this.extensions = {
      astc: gl.getExtension('WEBGL_compressed_texture_astc'),
      bptc: gl.getExtension('EXT_texture_compression_bptc'),
      etc1: gl.getExtension('WEBGL_compressed_texture_etc1'),
      etc2: gl.getExtension('WEBGL_compressed_texture_etc'),
      pvrtc: gl.getExtension('WEBGL_compressed_texture_pvrtc'),
      s3tc: gl.getExtension('WEBGL_compressed_texture_s3tc'),
    };

    this.uncompressedFormatList = [
      'rgb8unorm', 'rgba8unorm', 'rgb565unorm', 'rgba4unorm',
    ];

    this.supportedFormatList = [
      'rgb8unorm', 'rgba8unorm', 'rgb565unorm', 'rgba4unorm',
    ];

    if (this.isWebGL2) {
      this.uncompressedFormatList.push('rgb8unorm-srgb', 'rgba8unorm-srgb');
      this.supportedFormatList.push('rgb8unorm-srgb', 'rgba8unorm-srgb');
    } else {
      this.extensions.srgb = gl.getExtension('EXT_sRGB');
      if (this.extensions.srgb) {
        this.uncompressedFormatList.push('rgb8unorm-srgb', 'rgba8unorm-srgb');
        this.supportedFormatList.push('rgb8unorm-srgb', 'rgba8unorm-srgb');
      }
    }

    if (this.extensions.astc) {
      this.supportedFormatList.push('astc-4x4-rgba-unorm');
    }
    if (this.extensions.bptc) {
      this.supportedFormatList.push('bc7-rgba-unorm');
    }
    if (this.extensions.etc1) {
      this.supportedFormatList.push('etc1-rgb-unorm');
    }
    if (this.extensions.etc2) {
      this.supportedFormatList.push('etc2-rgba8unorm');
    }
    if (this.extensions.pvrtc) {
      this.supportedFormatList.push('pvrtc1-4bpp-rgb-unorm', 'pvrtc1-4bpp-rgba-unorm');
    }
    if (this.extensions.s3tc) {
      this.supportedFormatList.push('bc1-rgb-unorm', 'bc2-rgba-unorm', 'bc3-rgba-unorm');
    }
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
   * Creates a WebGLTexture from the given ImageBitmap.
   *
   * @param {module:External.ImageBitmap} imageBitmap - ImageBitmap source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromImageBitmap(imageBitmap, format, generateMipmaps) {
    const gl = this.gl;
    if (!gl) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    // For WebGL 1.0 only generate mipmaps if the texture is a power of two size.
    if (!this.isWebGL2 && generateMipmaps) {
      generateMipmaps = isPowerOfTwo(imageBitmap.width) && isPowerOfTwo(imageBitmap.height);
    }
    const mipLevels = generateMipmaps ? calculateMipLevels(imageBitmap.width, imageBitmap.height) : 1;

    const wtFormat = resolveFormat(format);
    if (wtFormat.compressed) {
      throw new Error(`Cannot create texture from image with compressed format "${format}"`);
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    if (this.isWebGL2) {
      gl.texStorage2D(gl.TEXTURE_2D, mipLevels, wtFormat.gl.sizedFormat, imageBitmap.width, imageBitmap.height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, wtFormat.gl.format, wtFormat.gl.type, imageBitmap);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, wtFormat.gl.format, wtFormat.gl.format, wtFormat.gl.type, imageBitmap);
    }

    if (mipLevels > 1) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    return new WebTextureResult(texture, {width: imageBitmap.width, height: imageBitmap.height, mipLevels, format});
  }

  /**
   * Creates a WebGLTexture from the given HTMLImageElement.
   *
   * @param {module:External.HTMLImageElement} image - image source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromImageElement(image, format, generateMipmaps) {
    // The methods called to createa a texture from an image element are exactly the same as the imageBitmap path.
    return this.textureFromImageBitmap(image, format, generateMipmaps);
  }

  /**
   * Creates a WebGLTexture from the given texture data.
   *
   * @param {module:WebTextureTool.WebTextureData} textureData - Object containing data and layout for each image and
   * mip level of the texture.
   * @param {boolean} generateMipmaps - True if mipmaps generation is desired. Only applies if a single level is given
   * and the texture format is renderable.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromTextureData(textureData, generateMipmaps) {
    const gl = this.gl;
    if (!gl) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const wtFormat = resolveFormat(textureData.format);

    // Can't automatically generate mipmaps for compressed formats.
    if (wtFormat.compressed) {
      generateMipmaps = false;
    }

    // For WebGL 1.0 only generate mipmaps if the texture is a power of two size.
    if (!this.isWebGL2 && generateMipmaps) {
      generateMipmaps = isPowerOfTwo(textureData.width) && isPowerOfTwo(textureData.height);
    }
    const mipLevelCount = textureData.levels.length > 1 ? textureData.levels.length :
                          (generateMipmaps ? calculateMipLevels(textureData.width, textureData.height) : 1);

    const target = webTextureTypeToGLTarget(textureData.type);

    const texture = gl.createTexture();
    gl.bindTexture(target, texture);

    const useTexStorage = this.isWebGL2 && (!wtFormat.compressed || wtFormat.gl.texStorage);
    if (useTexStorage) {
      gl.texStorage2D(target, mipLevelCount, wtFormat.gl.sizedFormat, textureData.width, textureData.height);
    }

    for (let levelIndex = 0; levelIndex < textureData.levels.length; ++levelIndex) {
      const level = textureData.levels[levelIndex];

      for (let sliceIndex = 0; sliceIndex < level.slices.length; ++sliceIndex) {
        const slice = level.slices[sliceIndex];
        const uploadTarget = target == GL.TEXTURE_CUBE_MAP ? GL.TEXTURE_CUBE_MAP_POSITIVE_X + sliceIndex : target;

        let sliceData;
        switch (textureData.format) {
          case 'rgb565unorm':
          case 'rgba4unorm':
          case 'rgba5551unorm':
            sliceData = new Uint16Array(slice.buffer, slice.byteOffset, slice.byteLength / 2);
            break;
          default:
            sliceData = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
            break;
        }

        if (wtFormat.compressed) {
          if (useTexStorage) {
            gl.compressedTexSubImage2D(
                uploadTarget, levelIndex,
                0, 0, level.width, level.height,
                wtFormat.gl.sizedFormat,
                sliceData);
          } else {
            gl.compressedTexImage2D(
                uploadTarget, levelIndex, wtFormat.gl.sizedFormat,
                level.width, level.height, 0,
                sliceData);
          }
        } else {
          if (useTexStorage) {
            gl.texSubImage2D(
                uploadTarget, levelIndex,
                0, 0, level.width, level.height,
                wtFormat.gl.format, wtFormat.gl.type,
                sliceData);
          } else {
            gl.texImage2D(
                uploadTarget, levelIndex, wtFormat.gl.sizedFormat,
                level.width, level.height, 0,
                wtFormat.gl.format, wtFormat.gl.type,
                sliceData);
          }
        }
      }
    }

    if (generateMipmaps && textureData.levels.length == 1) {
      gl.generateMipmap(target);
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
    this.gl = null;
  }
}

/**
 * Variant of WebTextureTool which produces WebGL textures.
 */
export class WebGLTextureTool extends WebTextureTool {
  /**
   * Creates a WebTextureTool instance which produces WebGL textures.
   *
   * @param {(module:External.WebGLRenderingContext|module:External.WebGL2RenderingContext)} gl - WebGL context to use.
   * @param {object} toolOptions - Options to initialize this WebTextureTool instance with.
   */
  constructor(gl, toolOptions) {
    super(new WebGLTextureClient(gl), toolOptions);
  }
}
