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

import { LightSpriteVertexSource, LightSpriteFragmentSource } from './shaders/light-sprite.js';
import { createShaderModuleDebug } from './wgsl-utils.js';

// Renders a billboarded sprite for a point light that uses no buffers or textures.
export class LightGroup {
  constructor(device, lightManager, frameBindGroupLayout, renderBundleDescriptor) {
    this.device = device;
    this.lightManager = lightManager;

    this.uniformsBuffer = this.device.createBuffer({
      size: lightManager.uniformArray.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    this.spritePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        frameBindGroupLayout, // set 0
      ]
    });

    this.spritePipeline = this.device.createRenderPipeline({
      layout: this.spritePipelineLayout,
      vertexStage: {
        module: createShaderModuleDebug(this.device, LightSpriteVertexSource(lightManager.maxLightCount)),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: createShaderModuleDebug(this.device, LightSpriteFragmentSource),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint32'
      },
      colorStates: [{
        format: renderBundleDescriptor.colorFormats[0],
        colorBlend: {
          srcFactor: 'src-alpha',
          dstFactor: 'one',
        }
      }],
      depthStencilState: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: renderBundleDescriptor.depthStencilFormat,
      },
      sampleCount: renderBundleDescriptor.sampleCount,
    });
  }

  updateUniforms() {
    // Update the light unform buffer with the latest values
    this.device.defaultQueue.writeBuffer(this.uniformsBuffer, 0, this.lightManager.uniformArray);
  }

  renderSprites(encoder) {
    encoder.setPipeline(this.spritePipeline);
    encoder.draw(4, this.lightManager.lightCount, 0, 0);
  }
}