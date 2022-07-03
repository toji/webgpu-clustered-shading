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

import { ProjectionUniforms, ViewUniforms, LightUniforms, ColorConversions } from './common.js';

export const LightSpriteVertexSource = `
  var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0)
  );

  ${ProjectionUniforms}
  ${ViewUniforms}
  ${LightUniforms}

  struct VertexInput {
    @builtin(vertex_index) vertexIndex : u32,
    @builtin(instance_index) instanceIndex : u32
  };

  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) localPos : vec2<f32>,
    @location(1) color: vec3<f32>
  };

  @vertex
  fn vertexMain(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;

    output.localPos = pos[input.vertexIndex];
    output.color = globalLights.lights[input.instanceIndex].color;
    let worldPos = vec3<f32>(output.localPos, 0.0) * globalLights.lights[input.instanceIndex].range * 0.025;

    // Generate a billboarded model view matrix
    var bbModelViewMatrix : mat4x4<f32>;
    bbModelViewMatrix[3] = vec4<f32>(globalLights.lights[input.instanceIndex].position, 1.0);
    bbModelViewMatrix = view.matrix * bbModelViewMatrix;
    bbModelViewMatrix[0][0] = 1.0;
    bbModelViewMatrix[0][1] = 0.0;
    bbModelViewMatrix[0][2] = 0.0;

    bbModelViewMatrix[1][0] = 0.0;
    bbModelViewMatrix[1][1] = 1.0;
    bbModelViewMatrix[1][2] = 0.0;

    bbModelViewMatrix[2][0] = 0.0;
    bbModelViewMatrix[2][1] = 0.0;
    bbModelViewMatrix[2][2] = 1.0;

    output.position = projection.matrix * bbModelViewMatrix * vec4<f32>(worldPos, 1.0);
    return output;
  }
`;

export const LightSpriteFragmentSource = `
  ${ColorConversions}

  struct FragmentInput {
    @location(0) localPos : vec2<f32>,
    @location(1) color: vec3<f32>
  };

  @fragment
  fn fragmentMain(input : FragmentInput) -> @location(0) vec4<f32> {
    let distToCenter = length(input.localPos);
    let fade = (1.0 - distToCenter) * (1.0 / (distToCenter * distToCenter));
    return vec4<f32>(linearTosRGB(input.color * fade), fade);
  }
`;
