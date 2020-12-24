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

export const ATTRIB_MAP = {
  POSITION: 1,
  NORMAL: 2,
  TANGENT: 3,
  TEXCOORD_0: 4,
  COLOR_0: 5,
};

export const UNIFORM_SET = {
  Frame: 0,
  Light: 1,
  Material: 2,
  Primitive: 3,
};

export const FrameUniforms = `
  [[block]] struct FrameUniforms {
    [[offset(0)]] projectionMatrix : mat4x4<f32>;
    [[offset(64)]] viewMatrix : mat4x4<f32>;
    [[offset(128)]] cameraPosition : vec3<f32>;
    [[offset(144)]] outputSize : vec2<f32>;
    [[offset(152)]] zNear : f32;
    [[offset(156)]] zFar : f32;
  };
  [[set(${UNIFORM_SET.Frame}), binding(0)]] var<uniform> frame : FrameUniforms;
`;

export function LightUniforms(maxLightCount) { return `
  struct Light {
    [[offset(0)]] position : vec3<f32>;
    [[offset(12)]] range : f32;
    [[offset(16)]] color : vec3<f32>;
  };

  [[block]] struct LightUniforms {
    [[offset(0)]] lightAmbient : vec3<f32>;
    [[offset(12)]] lightCount : u32;
    [[offset(16)]] lights : [[stride(32)]] array<Light, ${maxLightCount}>;
  };
  [[set(${UNIFORM_SET.Light}), binding(0)]] var<uniform> light : LightUniforms;
`};

export const SimpleVertexSource = `
  ${FrameUniforms}

  [[block]] struct PrimitiveUniforms {
    [[offset(0)]] modelMatrix : mat4x4<f32>;
  };
  [[set(${UNIFORM_SET.Primitive}), binding(0)]] var<uniform> primitive : PrimitiveUniforms;

  [[location(${ATTRIB_MAP.POSITION})]] var<in> POSITION : vec3<f32>;

  [[builtin(position)]] var<out> outPosition : vec4<f32>;

  [[stage(vertex)]]
  fn main() -> void {
    outPosition = frame.projectionMatrix * frame.viewMatrix * primitive.modelMatrix * vec4<f32>(POSITION, 1.0);
    return;
  }
`;
