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

import { WebGPURenderTechnique } from './webgpu-render-technique.js';
import { FrameUniforms, ATTRIB_MAP, UNIFORM_SET } from '../shaders/common.js';

export class DepthTechnique extends WebGPURenderTechnique {
  constructor(device, renderBundleDescriptor, pipelineLayout) {
    super(device, renderBundleDescriptor, pipelineLayout);
  }

  getVertexSource(defines) { return `
    ${FrameUniforms}

    [[block]] struct PrimitiveUniforms {
      [[offset(0)]] modelMatrix : mat4x4<f32>;
    };
    [[set(${UNIFORM_SET.Primitive}), binding(0)]] var<uniform> primitive : PrimitiveUniforms;

    [[location(${ATTRIB_MAP.POSITION})]] var<in> POSITION : vec3<f32>;

    [[location(0)]] var<out> vPos : vec4<f32>;
    [[builtin(position)]] var<out> outPosition : vec4<f32>;

    [[stage(vertex)]]
    fn main() -> void {
      var mPos : vec4<f32> = primitive.modelMatrix * vec4<f32>(POSITION, 1.0);
      outPosition = frame.projectionMatrix * frame.viewMatrix * mPos;
      vPos = outPosition;
      return;
    }
  `; }

  getFragmentSource(defines) { return `
    ${FrameUniforms}

    [[location(0)]] var<in> vPos : vec4<f32>;

    [[location(0)]] var<out> outColor : vec4<f32>;

    fn linearDepth(depthSample : f32) -> f32 {
      var depthRange : f32 = 2.0 * depthSample - 1.0;
      var linear : f32 = 2.0 * frame.zNear * frame.zFar / (frame.zFar + frame.zNear - depthRange * (frame.zFar - frame.zNear));
      return linear;
    }

    [[stage(fragment)]]
    fn main() -> void {
      var depth : f32 = vPos.z / vPos.w;
      outColor = vec4<f32>(depth, depth, depth, 1.0);
      return;
    }
  `; }
}