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

export const BIND_GROUP = {
  Frame: 0,
  Material: 1,
  Model: 2,
};

export const ProjectionUniformsSize = 144;
export const ProjectionUniforms = `
  [[block]] struct ProjectionUniforms {
    [[offset(0)]] matrix : mat4x4<f32>;
    [[offset(64)]] inverseMatrix : mat4x4<f32>;
    [[offset(128)]] outputSize : vec2<f32>;
    [[offset(136)]] zNear : f32;
    [[offset(140)]] zFar : f32;
  };
  [[group(${BIND_GROUP.Frame}), binding(0)]] var<uniform> projection : ProjectionUniforms;
`;

export const ViewUniformsSize = 80;
export const ViewUniforms = `
  [[block]] struct ViewUniforms {
    [[offset(0)]] matrix : mat4x4<f32>;
    [[offset(64)]] position : vec3<f32>;
    [[offset(76)]] dummy : f32;
  };
  [[group(${BIND_GROUP.Frame}), binding(1)]] var<uniform> view : ViewUniforms;
`;

export const LightUniforms = `
  struct Light {
    [[offset(0)]] position : vec3<f32>;
    [[offset(12)]] range : f32;
    [[offset(16)]] color : vec3<f32>;
  };

  [[block]] struct GlobalLightUniforms {
    [[offset(0)]] ambient : vec3<f32>;
    [[offset(12)]] lightCount : u32;
    [[offset(16)]] lights : [[stride(32)]] array<Light>;
  };
  [[group(${BIND_GROUP.Frame}), binding(2)]] var<storage> globalLights : [[access(read)]] GlobalLightUniforms;
`;

export const ModelUniformsSize = 64;
export const ModelUniforms = `
  [[block]] struct ModelUniforms {
    [[offset(0)]] matrix : mat4x4<f32>;
  };
  [[group(${BIND_GROUP.Model}), binding(0)]] var<uniform> model : ModelUniforms;
`;

export const MaterialUniformsSize = 48;
export const MaterialUniforms = `
  [[block]] struct MaterialUniforms {
    [[offset(0)]] baseColorFactor : vec4<f32>;
    [[offset(16)]] metallicRoughnessFactor : vec2<f32>;
    [[offset(32)]] emissiveFactor : vec3<f32>;
    [[offset(44)]] occlusionStrength : f32;
  };
  [[group(${BIND_GROUP.Material}), binding(0)]] var<uniform> material : MaterialUniforms;

  [[group(${BIND_GROUP.Material}), binding(1)]] var<uniform_constant> defaultSampler : sampler;
  [[group(${BIND_GROUP.Material}), binding(2)]] var<uniform_constant> baseColorTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(3)]] var<uniform_constant> normalTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(4)]] var<uniform_constant> metallicRoughnessTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(5)]] var<uniform_constant> occlusionTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(6)]] var<uniform_constant> emissiveTexture : texture_2d<f32>;
`;

export const SimpleVertexSource = `
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${ModelUniforms}

  [[location(${ATTRIB_MAP.POSITION})]] var<in> POSITION : vec3<f32>;

  [[builtin(position)]] var<out> outPosition : vec4<f32>;

  [[stage(vertex)]]
  fn main() -> void {
    outPosition = projection.matrix * view.matrix * model.matrix * vec4<f32>(POSITION, 1.0);
    return;
  }
`;
