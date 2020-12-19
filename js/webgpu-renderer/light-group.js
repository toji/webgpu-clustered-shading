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

import { createShaderModuleDebug } from './wgsl-utils.js';

// Renders a billboarded sprite for a point light that uses no buffers or textures.
const LightSpriteShader = {
  vertexCount: 4,

  vertexSource: `
  var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0)
  );

  [[block]] struct FrameUniforms {
    [[offset(0)]] projectionMatrix : mat4x4<f32>;
    [[offset(64)]] viewMatrix : mat4x4<f32>;
    [[offset(128)]] cameraPosition : vec3<f32>;
  };
  [[set(0), binding(0)]] var<uniform> frame : FrameUniforms;

  struct Light {
    [[offset(0)]] position : vec3<f32>;
    [[offset(16)]] color : vec3<f32>;
  };

  [[block]] struct LightUniforms {
    [[offset(0)]] lights : [[stride(32)]] array<Light, 5>;
    [[offset(160)]] lightAmbient : f32;
  };
  [[set(1), binding(0)]] var<uniform> light : LightUniforms;

  [[location(0)]] var<out> vPos : vec2<f32>;
  [[location(1)]] var<out> vColor : vec3<f32>;

  [[builtin(position)]] var<out> outPosition : vec4<f32>;
  [[builtin(vertex_idx)]] var<in> vertexIndex : i32;
  [[builtin(instance_idx)]] var<in> instanceIndex : i32;

  [[stage(vertex)]]
  fn main() -> void {
    const lightSize : f32 = 0.2;

    vPos = pos[vertexIndex];
    vColor = light.lights[instanceIndex].color;
    var worldPos : vec3<f32> = vec3<f32>(vPos, 0.0) * lightSize;

    # Generate a billboarded model view matrix
    var bbModelViewMatrix : mat4x4<f32>;
    bbModelViewMatrix[3] = vec4<f32>(light.lights[instanceIndex].position, 1.0);
    bbModelViewMatrix = frame.viewMatrix * bbModelViewMatrix;
    bbModelViewMatrix[0][0] = 1.0;
    bbModelViewMatrix[0][1] = 0.0;
    bbModelViewMatrix[0][2] = 0.0;

    bbModelViewMatrix[1][0] = 0.0;
    bbModelViewMatrix[1][1] = 1.0;
    bbModelViewMatrix[1][2] = 0.0;

    bbModelViewMatrix[2][0] = 0.0;
    bbModelViewMatrix[2][1] = 0.0;
    bbModelViewMatrix[2][2] = 1.0;

    outPosition = frame.projectionMatrix * bbModelViewMatrix * vec4<f32>(worldPos, 1.0);
    return;
  }`,

  fragmentSource: `
  [[location(0)]] var<out> outColor : vec4<f32>;

  [[location(0)]] var<in> vPos : vec2<f32>;
  [[location(1)]] var<in> vColor : vec3<f32>;

  [[stage(fragment)]]
  fn main() -> void {
    var distToCenter : f32 = length(vPos);
    var fade : f32 = (1.0 - distToCenter) * (1.0 / (distToCenter * distToCenter));
    outColor = vec4<f32>(vColor * fade, fade);
    return;
  }`,
};

export class LightGroup {
  constructor(device, maxLightCount,
    /* TODO: Refactor this */
    lightUniforms, frameBindGroupLayout, SWAP_CHAIN_FORMAT, DEPTH_FORMAT, SAMPLE_COUNT) {
    this.device = device;
    this.lightCount = maxLightCount;

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        type: 'uniform-buffer'
      }]
    });

    this.uniformsBuffer = this.device.createBuffer({
      size: lightUniforms.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.uniformBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.uniformsBuffer,
        },
      }],
    });

    this.spritePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        frameBindGroupLayout, // set 0
        this.bindGroupLayout, // set 1
      ]
    });

    this.spritePipeline = this.device.createRenderPipeline({
      layout: this.spritePipelineLayout,
      vertexStage: {
        module: createShaderModuleDebug(this.device, LightSpriteShader.vertexSource),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: createShaderModuleDebug(this.device, LightSpriteShader.fragmentSource),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint32'
      },
      colorStates: [{
        format: SWAP_CHAIN_FORMAT,
        colorBlend: {
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
        }
      }],
      depthStencilState: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: DEPTH_FORMAT,
      },
      sampleCount: SAMPLE_COUNT,
    });
  }

  renderSprites(encoder) {
    encoder.setPipeline(this.spritePipeline);
    encoder.draw(LightSpriteShader.vertexCount, this.lightCount, 0, 0);
  }
}