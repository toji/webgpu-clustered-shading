// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { vec3, mat4 } from './third-party/gl-matrix/src/gl-matrix.js';

const lightFloatCount = 8;
const lightByteSize = lightFloatCount * 4;

class Light {
  constructor(buffer, offset) {
    this.position = new Float32Array(buffer, offset, 3);
    this.color = new Float32Array(buffer, offset + 4 * 4, 3);
    this._attenuation = new Float32Array(buffer, offset + 7 * 4, 1);
  }

  get attenuation() {
    return this._attenuation[0];
  }

  set attenuation(value) {
    return this._attenuation[0] = value;
  }
}

export class Renderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.camera = null;
    this.rafId = 0;

    // Storage for global uniforms.
    // These can either be used individually or as a uniform buffer.
    this.frameUniforms = new Float32Array(16 + 16 + 4);

    this.projectionMatrix = new Float32Array(this.frameUniforms.buffer, 0, 16);
    this.viewMatrix = new Float32Array(this.frameUniforms.buffer, 16 * 4, 16);
    this.cameraPosition = new Float32Array(this.frameUniforms.buffer, 32 * 4, 3);

    this.lightCount = 5;

    this.lightUniforms = new Float32Array(lightFloatCount * this.lightCount + 4);

    this.lights = new Array(this.lightCount);
    for (let i = 0; i < this.lightCount; ++i) {
      this.lights[i] = new Light(this.lightUniforms.buffer, lightByteSize * i);
    }

    this.lightAmbient = new Float32Array(this.lightUniforms.buffer, (lightByteSize * this.lightCount), 4);

    // Central wandering light
    vec3.set(this.lights[0].position, 0, 1.5, 0);
    vec3.set(this.lights[0].color, 10, 10, 10);
    this.lights[0].attenuation = 0.25;

    // Lights in each corner over the birdbath things.
    vec3.set(this.lights[1].position, 8.95, 1, -3.55);
    vec3.set(this.lights[1].color, 5, 1, 1);
    this.lights[1].attenuation = 0.25;

    vec3.set(this.lights[2].position, 8.95, 1, 3.2);
    vec3.set(this.lights[2].color, 5, 1, 1);
    this.lights[2].attenuation = 0.25;

    vec3.set(this.lights[3].position, -9.65, 1, -3.55);
    vec3.set(this.lights[3].color, 1, 1, 5);
    this.lights[3].attenuation = 0.25;

    vec3.set(this.lights[4].position, -9.65, 1, 3.2);
    vec3.set(this.lights[4].color, 1, 1, 5);
    this.lights[4].attenuation = 0.25;

    this.lightAmbient[0] = 0.05;

    this.frameCallback = (timestamp) => {
      this.rafId = requestAnimationFrame(this.frameCallback);
      if (this.stats) {
        this.stats.begin();
      }

      this.beforeFrame(timestamp);

      this.onFrame(timestamp);

      if (this.stats) {
        this.stats.end();
      }
    };

    this.resizeCallback = () => {
      this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
      this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

      const aspect = this.canvas.width / this.canvas.height;
      mat4.perspective(this.projectionMatrix, Math.PI * 0.5, aspect, 0.1, 1000.0);

      this.onResize(this.canvas.width, this.canvas.height);
    };
  }

  async init() {
    // Override with renderer-specific initialization logic.
  }

  setStats(stats) {
    this.stats = stats;
  }

  setGltf(gltf) {
    // Override with renderer-specific mesh loading logic.
  }

  setViewMatrix(viewMatrix) {
    mat4.copy(this.viewMatrix, viewMatrix);
  }

  start() {
    window.addEventListener('resize', this.resizeCallback);
    this.resizeCallback();
    this.rafId = requestAnimationFrame(this.frameCallback);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    window.removeEventListener('resize', this.resizeCallback);
  }

  // Handles frame logic that's common to all renderers.
  beforeFrame(timestamp) {
    // Copy values from the camera into our frame uniform buffers
    mat4.copy(this.viewMatrix, this.camera.viewMatrix);
    vec3.copy(this.cameraPosition, this.camera.position);

    // Update the lights
    vec3.set(this.lights[0].position,
      Math.sin(timestamp / 1500) * 4,
      Math.cos(timestamp / 600) * 0.25 + 1.5,
      Math.cos(timestamp / 500) * 0.75);

    // Add a little bit of a flicker to the light
    this.lights[0].attenuation = Math.min(0.75, Math.max(0.25, this.lights[0].attenuation + (Math.random() - 0.5) * 0.15));

    for (let i = 1; i < 5; ++i) {
      this.lights[i].position[1] = 1.25 + Math.sin((timestamp + i * 250) / 800) * 0.1;
      this.lights[i].attenuation = Math.min(1.5, Math.max(0.25, this.lights[i].attenuation + (Math.random() - 0.5) * 0.15));
    }
  }

  onResize(width, height) {
    // Override with renderer-specific resize logic.
  }

  onFrame(timestamp) {
    // Override with renderer-specific frame logic.
  }


}