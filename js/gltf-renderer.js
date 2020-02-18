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

import { mat4 } from './third-party/gl-matrix/src/gl-matrix.js';

export class GltfRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.projectionMatrix = mat4.create();

    this.rafId = 0;

    this.frameCallback = (timestamp) => {
      this.rafId = requestAnimationFrame(this.frameCallback);
      this.onFrame(timestamp);
    };

    this.resizeCallback = () => {
      this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
      this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

      const aspect = this.canvas.width / this.canvas.height;
      mat4.perspective(this.projectionMatrix, Math.PI * 0.5, aspect, 0.1, 1000.0);

      this.onResize(this.canvas.width, this.canvas.height);
    };
    window.addEventListener('resize', this.resizeCallback);
  }

  async init() {
    // Override with renderer-specific initialization logic here.
  }

  start() {
    this.resizeCallback();
    this.rafId = requestAnimationFrame(this.frameCallback);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  onResize(width, height) {
    // Override with renderer-specific resize logic here.
  }

  onFrame(timestamp) {
    // Override with renderer-specific frame logic here.
  }


}