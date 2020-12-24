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
import { FrameUniforms, SimpleVertexSource } from '../shaders/common.js';

/**
 * Technique visualizes simple depth info as greyscale range.
 */
export class DepthTechnique extends WebGPURenderTechnique {
  constructor(device, renderBundleDescriptor, pipelineLayout) {
    super(device, renderBundleDescriptor, pipelineLayout);
  }

  getVertexSource(defines) { return SimpleVertexSource; }

  getFragmentSource(defines) { return `
    ${FrameUniforms}

    [[builtin(frag_coord)]] var<in> fragCoord : vec4<f32>;

    [[location(0)]] var<out> outColor : vec4<f32>;

    [[stage(fragment)]]
    fn main() -> void {
      outColor = vec4<f32>(fragCoord.zzz, 1.0);
      return;
    }
  `; }
}

const TileFunctions = `
const tileCount : vec3<i32> = vec3<i32>(16, 10, 24);

fn linearDepth(depthSample : f32) -> f32 {
  var depthRange : f32 = 2.0 * depthSample - 1.0;
  var linear : f32 = 2.0 * frame.zNear * frame.zFar / (frame.zFar + frame.zNear - depthRange * (frame.zFar - frame.zNear));
  return linear;
}

fn getTile(fragCoord : vec4<f32>) -> vec3<i32> {
  # TODO: scale and bias calculation can be moved outside the shader to save cycles.
  var sliceScale : f32 = f32(tileCount.z) / log2(frame.zFar / frame.zNear);
  var sliceBias : f32 = -(f32(tileCount.z) * log2(frame.zNear) / log2(frame.zFar / frame.zNear));
  var zTile : i32 = i32(max(log2(linearDepth(fragCoord.z)) * sliceScale + sliceBias, 0.0));

  return vec3<i32>(i32(fragCoord.x / (frame.outputSize.x / f32(tileCount.x))),
                   i32(fragCoord.y / (frame.outputSize.y / f32(tileCount.y))),
                   zTile);
}

fn getClusterIndex(fragCoord : vec4<f32>) -> i32 {
  const tile : vec3<i32> = getTile(fragCoord);
  return tile.x +
         tile.y * tileCount.x +
         tile.z * tileCount.x * tileCount.y;
}
`;

/**
 * Technique visualizes which depth slice a given fragment would be assigned to.
 */
export class DepthSliceTechnique extends WebGPURenderTechnique {
  constructor(device, renderBundleDescriptor, pipelineLayout) {
    super(device, renderBundleDescriptor, pipelineLayout);
  }

  getVertexSource(defines) { return SimpleVertexSource; }

  getFragmentSource(defines) { return `
    ${FrameUniforms}
    ${TileFunctions}

    var<private> colorSet : array<vec3<f32>, 9> = array<vec3<f32>, 9>(
      vec3<f32>(1.0, 0.0, 0.0),
      vec3<f32>(1.0, 0.5, 0.0),
      vec3<f32>(0.5, 1.0, 0.0),
      vec3<f32>(0.0, 1.0, 0.0),
      vec3<f32>(0.0, 1.0, 0.5),
      vec3<f32>(0.0, 0.5, 1.0),
      vec3<f32>(0.0, 0.0, 1.0),
      vec3<f32>(0.5, 0.0, 1.0),
      vec3<f32>(1.0, 0.0, 0.5)
    );

    [[builtin(frag_coord)]] var<in> fragCoord : vec4<f32>;

    [[location(0)]] var<out> outColor : vec4<f32>;

    [[stage(fragment)]]
    fn main() -> void {
      var tile : vec3<i32> = getTile(fragCoord);
      outColor = vec4<f32>(colorSet[tile.z % 9], 1.0);
      return;
    }
  `; }
}