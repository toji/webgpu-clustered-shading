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
  static floatSize = 8;
  static byteSize = Light.floatSize * 4;

  constructor(buffer, byteOffset) {
    this.position = new Float32Array(buffer, byteOffset, 4);
    this.rangeArray = new Float32Array(buffer, byteOffset + 12, 1);
    this.color = new Float32Array(buffer, byteOffset + 16, 4);
    this.velocity = new Float32Array(3);
    this.destination = new Float32Array(3);
    this.travelTime = 0;
  }

  get range() {
    return this.rangeArray[0];
  }

  set range(value) {
    this.rangeArray[0] = value;
  }
}

class LightManager extends EventTarget {
  constructor(lightCount) {
    super();

    this.maxLightCount = lightCount;

    this.uniformArray = new Float32Array(4 + Light.floatSize * lightCount);

    this.ambientColor = new Float32Array(this.uniformArray.buffer, 0, 3);
    this.lightCountArray = new Uint32Array(this.uniformArray.buffer, 12, 1);
    this.lightCountArray[0] = lightCount;

    this.lights = new Array(lightCount);
    for (let i = 0; i < lightCount; ++i) {
      this.lights[i] = new Light(this.uniformArray.buffer, 16 + lightByteSize * i);
    }
  }

  get lightCount() {
    return this.lightCountArray[0];
  }

  set lightCount(value) {
    this.lightCountArray[0] = Math.min(value, this.maxLightCount);
  }
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

export class Renderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.camera = null;
    this.rafId = 0;
    this.frameCount = -1;

    // Storage for global uniforms.
    // These can either be used individually or as a uniform buffer.
    this.frameUniforms = new Float32Array(16 + 16 + 4);

    this.projectionMatrix = new Float32Array(this.frameUniforms.buffer, 0, 16);
    this.viewMatrix = new Float32Array(this.frameUniforms.buffer, 16 * 4, 16);
    this.cameraPosition = new Float32Array(this.frameUniforms.buffer, 32 * 4, 3);

    // Allocate all the scene's lights
    this.lightManager = new LightManager(500);

    // Ambient color
    vec3.set(this.lightManager.ambientColor, 0.002, 0.002, 0.002);

    // Initialize positions and colors for all the lights
    for (let i = 0; i < this.lightManager.maxLightCount; ++i) {
      let light = this.lightManager.lights[i];

      // Sponza scene approximate bounds:
      // X [-11, 10]
      // Y [0.2, 6.5]
      // Z [-4.5, 4.0]
      light.position[0] = randomBetween(-11, 10);
      light.position[1] = randomBetween(0.2, 6.5);
      light.position[2] = randomBetween(-4.5, 4.0);

      light.range = randomBetween(0.5, 5);

      vec3.set(light.color,
        randomBetween(0.1, 1),
        randomBetween(0.1, 1),
        randomBetween(0.1, 1)
      );
    }

    let lastTimestamp = -1;
    this.frameCallback = (timestamp) => {
      const timeDelta = lastTimestamp == -1 ? 0 : timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      this.rafId = requestAnimationFrame(this.frameCallback);
      this.frameCount++;
      if (this.frameCount % 200 == 0) { return; }

      if (this.stats) {
        this.stats.begin();
      }

      this.beforeFrame(timestamp, timeDelta);

      this.onFrame(timestamp, timeDelta);

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
  beforeFrame(timestamp, timeDelta) {
    // Copy values from the camera into our frame uniform buffers
    mat4.copy(this.viewMatrix, this.camera.viewMatrix);
    vec3.copy(this.cameraPosition, this.camera.position);

    // Update each light position with a wandering pattern.
    for (let i = 0; i < this.lightManager.lightCount; ++i) {
      let light = this.lightManager.lights[i];

      light.travelTime -= timeDelta;

      if (light.travelTime <= 0) {
        light.travelTime = randomBetween(500, 2000);
        light.destination[0] = randomBetween(-11, 10);
        light.destination[1] = randomBetween(0.2, 6.5);
        light.destination[2] = randomBetween(-4.5, 4.0);
      }

      light.velocity[0] += (light.destination[0] - light.position[0]) * 0.000005 * timeDelta;
      light.velocity[1] += (light.destination[1] - light.position[1]) * 0.000005 * timeDelta;
      light.velocity[2] += (light.destination[2] - light.position[2]) * 0.000005 * timeDelta;

      // Clamp the velocity
      if (vec3.length(light.velocity) > 0.05) {
        vec3.scale(light.velocity, vec3.normalize(light.velocity, light.velocity), 0.05);
      }

      vec3.add(light.position, light.position, light.velocity);
    }
  }

  onResize(width, height) {
    // Override with renderer-specific resize logic.
  }

  onFrame(timestamp) {
    // Override with renderer-specific frame logic.
  }


}