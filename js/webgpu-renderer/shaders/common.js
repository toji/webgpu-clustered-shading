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
    matrix : mat4x4<f32>;
    inverseMatrix : mat4x4<f32>;
    outputSize : vec2<f32>;
    zNear : f32;
    zFar : f32;
  };
  [[group(${BIND_GROUP.Frame}), binding(0)]] var<uniform> projection : ProjectionUniforms;
`;

export const ViewUniformsSize = 80;
export const ViewUniforms = `
  [[block]] struct ViewUniforms {
    matrix : mat4x4<f32>;
    position : vec3<f32>;
  };
  [[group(${BIND_GROUP.Frame}), binding(1)]] var<uniform> view : ViewUniforms;
`;

export const LightUniforms = `
  struct Light {
    position : vec3<f32>;
    range : f32;
    color : vec3<f32>;
  };

  [[block]] struct GlobalLightUniforms {
    ambient : vec3<f32>;
    lightCount : u32;
    lights : [[stride(32)]] array<Light>;
  };
  [[group(${BIND_GROUP.Frame}), binding(2)]] var<storage> globalLights : [[access(read)]] GlobalLightUniforms;
`;

export const ModelUniformsSize = 64;
export const ModelUniforms = `
  [[block]] struct ModelUniforms {
    matrix : mat4x4<f32>;
  };
  [[group(${BIND_GROUP.Model}), binding(0)]] var<uniform> model : ModelUniforms;
`;

export const MaterialUniformsSize = 48;
export const MaterialUniforms = `
  [[block]] struct MaterialUniforms {
    baseColorFactor : vec4<f32>;
    metallicRoughnessFactor : vec2<f32>;
    emissiveFactor : vec3<f32>;
    occlusionStrength : f32;
  };
  [[group(${BIND_GROUP.Material}), binding(0)]] var<uniform> material : MaterialUniforms;

  [[group(${BIND_GROUP.Material}), binding(1)]] var defaultSampler : sampler;
  [[group(${BIND_GROUP.Material}), binding(2)]] var baseColorTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(3)]] var normalTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(4)]] var metallicRoughnessTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(5)]] var occlusionTexture : texture_2d<f32>;
  [[group(${BIND_GROUP.Material}), binding(6)]] var emissiveTexture : texture_2d<f32>;
`;

export const SimpleVertexSource = `
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${ModelUniforms}

  [[stage(vertex)]]
  fn main([[location(${ATTRIB_MAP.POSITION})]] POSITION : vec3<f32>) -> [[builtin(position)]] vec4<f32> {
    return projection.matrix * view.matrix * model.matrix * vec4<f32>(POSITION, 1.0);
  }
`;
