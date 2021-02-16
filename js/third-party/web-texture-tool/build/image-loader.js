/**
 * @file Loader which handles any image types supported directly by the browser.
 * @module ImageLoader
 */

const MIME_TYPE_FORMATS = {
  'image/jpeg': 'rgb8unorm',
  'image/png': 'rgba8unorm',
  'image/apng': 'rgba8unorm',
  'image/gif': 'rgba8unorm',
  'image/bmp': 'rgb8unorm',
  'image/webp': 'rgba8unorm',
  'image/x-icon': 'rgba8unorm',
  'image/svg+xml': 'rgba8unorm',
};
const IMAGE_BITMAP_SUPPORTED = (typeof createImageBitmap !== 'undefined');

/**
 * Loader which handles any image types supported directly by the browser.
 */
export class ImageLoader {
  /**
   * Creates a ImageTextureLoader instance.
   * Should only be called by the WebTextureTool constructor.
   */
  constructor() {
  }

  /**
   * Which MIME types this loader supports.
   *
   * @returns {Array<string>} - An array of the MIME types this loader supports.
   */
  static supportedMIMETypes() {
    return Object.keys(MIME_TYPE_FORMATS);
  }

  /**
   * Load a supported file as a texture from the given URL.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {string} url - An absolute URL that the texture file should be loaded from.
   * @param {object} options - Options for how the loaded texture should be handled.
   * @returns {Promise<module:WebTextureLoader.WebTextureResult>} - The WebTextureResult obtained from passing the
   * parsed file data to the client.
   */
  async fromUrl(client, url, options) {
    let format = MIME_TYPE_FORMATS[options.mimeType];

    if (client.supportedFormatList.indexOf(format) == -1) {
      // 'rgba8unorm' must be supported by all clients
      format = 'rgba8unorm';
    }

    if (IMAGE_BITMAP_SUPPORTED) {
      const response = await fetch(url);
      const imageBitmap = await createImageBitmap(await response.blob());
      return client.fromImageBitmap(imageBitmap, format, options.mipmaps);
    } else {
      return new Promise((resolve, reject) => {
        const imageElement = new Image();
        imageElement.addEventListener('load', () => {
          resolve(client.textureFromImageElement(imageElement, format, options.mipmaps));
        });
        imageElement.addEventListener('error', function(err) {
          reject(err);
        });
        imageElement.src = url;
      });
    };
  }

  /**
   * Load a supported file as a texture from the given Blob.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {Blob} blob - Blob containing the texture file data.
   * @param {object} options - Options for how the loaded texture should be handled.
   * @returns {Promise<module:WebTextureLoader.WebTextureResult>} - The WebTextureResult obtained from passing the
   * parsed file data to the client.
   */
  async fromBlob(client, blob, options) {
    let format = MIME_TYPE_FORMATS[blob.type];

    if (client.supportedFormatList.indexOf(format) == -1) {
      // 'rgba8unorm' must be supported by all clients
      format = 'rgba8unorm';
    }

    if (IMAGE_BITMAP_SUPPORTED) {
      const imageBitmap = await createImageBitmap(blob);
      return client.fromImageBitmap(imageBitmap, format, options.mipmaps);
    } else {
      return new Promise((resolve, reject) => {
        const imageElement = new Image();
        imageElement.addEventListener('load', () => {
          resolve(client.fromImageElement(imageElement, format, options.mipmaps));
        });
        imageElement.addEventListener('error', function(err) {
          reject(err);
        });
        const url = window.URL.createObjectURL(blob);
        imageElement.src = url;
      });
    };
  }

  /**
   * Load a supported file as a texture from the given ArrayBuffer or ArrayBufferView.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {ArrayBuffer|ArrayBufferView} buffer - Buffer containing the texture file data.
   * @param {object} options - Options for how the loaded texture should be handled.
   * @returns {Promise<module:WebTextureLoader.WebTextureResult>} - The WebTextureResult obtained from passing the
   * parsed file data to the client.
   */
  async fromBuffer(client, buffer, options) {
    const blob = new Blob(buffer, {type: options.mimeType});
    return this.fromBlob(client, blob, options);
  }

  /**
   * Destroy this loader.
   *
   * @returns {void}
   */
  destroy() {
    // Nothing to clean up here.
  }
}
