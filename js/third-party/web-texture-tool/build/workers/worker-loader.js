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
 * Generic loader which handles texture loading in a worker in order to prevent blocking the main thread.
 *
 * @file Loader that operates a worker script
 * @module WorkerLoader
 */

/**
 * Tracks required data for fulfilling a texture request once it has been transcoded.
 */
class PendingTextureRequest {
  /**
   * Creates a PendingTextureRequest instance.
   *
   * @param {object} client - The WebTextureClient that will upload the transcoded data.
   * @param {*} options - Options passed during the texture request.
   * @param {*} resolve - Success callback.
   * @param {*} reject - Failure callback.
   */
  constructor(client, options, resolve, reject) {
    this.client = client;
    this.options = options;
    this.resolve = resolve;
    this.reject = reject;
  }
};

const pendingTextures = {};
let nextPendingTextureId = 1;

/**
 * Called when the worker either finished transcoding a file or encounters an error.
 *
 * @param {object} msg - Message contents from the worker
 * @returns {void}
 */
function onWorkerMessage(msg) {
  // Find the pending texture associated with the data we just received
  // from the worker.
  const pendingTexture = pendingTextures[msg.data.id];
  if (!pendingTexture) {
    if (msg.data.error) {
      console.error(`Texture load failed: ${msg.data.error}`);
    }
    console.error(`Invalid pending texture ID: ${msg.data.id}`);
    return;
  }

  // Remove the pending texture from the waiting list.
  delete pendingTextures[msg.data.id];

  // If the worker indicated an error has occured handle it now.
  if (msg.data.error) {
    console.error(`Texture load failed: ${msg.data.error}`);
    pendingTexture.reject(`${msg.data.error}`);
    return;
  }

  // Upload the image data returned by the worker.
  const result = pendingTexture.client.textureFromTextureData(msg.data, pendingTexture.options.mipmaps);
  pendingTexture.resolve(result);
}

/**
 * Loader which handles Basis Universal files.
 */
export class WorkerLoader {
  /**
   * Creates a WorkerLoader instance.
   *
   * @param {string} relativeWorkerPath - Path to the worker script to load, relative to this file.
   */
  constructor(relativeWorkerPath) {
    // Load the worker script.
    const workerPath = import.meta.url.replace('worker-loader.js', relativeWorkerPath);
    this.worker = new Worker(workerPath);
    this.worker.onmessage = onWorkerMessage;
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
  async loadTextureFromUrl(client, url, options) {
    const pendingTextureId = nextPendingTextureId++;

    this.worker.postMessage({
      id: pendingTextureId,
      url: url,
      supportedFormats: client.supportedFormats(),
      mipmaps: options.mipmaps,
      extension: options.extension,
    });

    return new Promise((resolve, reject) => {
      pendingTextures[pendingTextureId] = new PendingTextureRequest(client, options, resolve, reject);
    });
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
  async loadTextureFromBlob(client, blob, options) {
    const buffer = await blob.arrayBuffer();
    return this.loadTextureFromBuffer(client, buffer, options);
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
  async loadTextureFromBuffer(client, buffer, options) {
    const pendingTextureId = nextPendingTextureId++;

    this.worker.postMessage({
      id: pendingTextureId,
      buffer: buffer,
      supportedFormats: client.supportedFormats(),
      mipmaps: options.mipmaps,
      extension: options.extension,
    });

    return new Promise((resolve, reject) => {
      pendingTextures[pendingTextureId] = new PendingTextureRequest(client, options, resolve, reject);
    });
  }

  /**
   * Destroy this loader.
   * Terminates the worker and rejects any outstanding textures. The loader is unusable after calling destroy().
   *
   * @returns {void}
   */
  destroy() {
    if (this.worker) {
      this.worker.terminate();

      const destroyedError = new Error('Texture loader was destroyed.');
      for (const pendingTexture of pendingTextures) {
        pendingTexture.reject(destroyedError);
      }
    }
  }
}
