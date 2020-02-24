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

import glslangModule from 'https://unpkg.com/@webgpu/glslang@0.0.7/web/glslang.js';

let glslang;

const PBR_VERTEX_SOURCE = `#version 450
  layout(set = 0, binding = 0) uniform FrameUniforms {
    mat4 projectionMatrix;
    mat4 viewMatrix;
    vec3 cameraPosition;
    vec3 lightDirection;
    vec3 lightColor;
  };

  layout(set = 2, binding = 0) uniform PrimitiveUniforms {
    mat4 modelMatrix;
  };

  layout(location = 0) in vec3 position;
  layout(location = 1) in vec3 normal;
  layout(location = 3) in vec2 texcoord_0;

  layout(location = 0) out vec3 vLight; // Vector from vertex to light.
  layout(location = 1) out vec3 vLightColor;
  layout(location = 2) out vec3 vView; // Vector from vertex to camera.
  layout(location = 3) out vec2 vTex;
  layout(location = 4) out vec3 vNorm;

  void main() {
    vec3 n = normalize(vec3(modelMatrix * vec4(normal, 0.0)));
    vNorm = n;

    vec4 mPos = modelMatrix * vec4(position, 1.0);
    vTex = texcoord_0;
    vLight = -lightDirection;
    vView = cameraPosition - mPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * mPos;
  }`;

const EPIC_PBR_FUNCTIONS = `
  vec3 lambertDiffuse(vec3 cDiff) {
    return cDiff / M_PI;
  }

  float specD(float a, float nDotH) {
    float aSqr = a * a;
    float f = ((nDotH * nDotH) * (aSqr - 1.0) + 1.0);
    return aSqr / (M_PI * f * f);
  }

  float specG(float roughness, float nDotL, float nDotV) {
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float gl = nDotL / (nDotL * (1.0 - k) + k);
    float gv = nDotV / (nDotV * (1.0 - k) + k);
    return gl * gv;
  }

  vec3 specF(float vDotH, vec3 F0) {
    float exponent = (-5.55473 * vDotH - 6.98316) * vDotH;
    float base = 2.0;
    return F0 + (1.0 - F0) * pow(base, exponent);
  }`;

const PBR_FRAGMENT_SOURCE = `#version 450
  layout(set = 1, binding = 0) uniform MaterialUniforms {
    vec4 baseColorFactor;
    vec2 metallicRoughnessFactor;
    vec3 emissiveFactor;
  };

  layout(set = 1, binding = 1) uniform texture2D baseColorTex;
  layout(set = 1, binding = 2) uniform sampler baseColorSampler;

  layout(location = 0) in vec3 vLight; // Vector from vertex to light.
  layout(location = 1) in vec3 vLightColor;
  layout(location = 2) in vec3 vView; // Vector from vertex to camera.
  layout(location = 3) in vec2 vTex;
  layout(location = 4) in vec3 vNorm;

  layout(location = 0) out vec4 outColor;

  const vec3 dielectricSpec = vec3(0.04);
  const vec3 black = vec3(0.0);

  #define M_PI 3.14159265

  ${EPIC_PBR_FUNCTIONS}

  void main() {
    vec4 baseColor = texture(sampler2D(baseColorTex, baseColorSampler), vTex) * baseColorFactor;
    vec3 n = normalize(vNorm);

    float metallic = metallicRoughnessFactor.x;
    float roughness = metallicRoughnessFactor.y;

    vec3 l = normalize(vLight);
    vec3 v = normalize(vView);
    vec3 h = normalize(l+v);

    float nDotL = clamp(dot(n, l), 0.001, 1.0);
    float nDotV = abs(dot(n, v)) + 0.001;
    float nDotH = max(dot(n, h), 0.0);
    float vDotH = max(dot(v, h), 0.0);

    // From GLTF Spec
    vec3 cDiff = mix(baseColor.rgb * (1.0 - dielectricSpec.r), black, metallic); // Diffuse color
    vec3 F0 = mix(dielectricSpec, baseColor.rgb, metallic); // Specular color
    float a = roughness * roughness;

    vec3 F = specF(vDotH, F0);
    float D = specD(a, nDotH);
    float G = specG(roughness, nDotL, nDotV);
    vec3 specular = (D * F * G) / (4.0 * nDotL * nDotV);

    float halfLambert = dot(n, l) * 0.5 + 0.5;
    halfLambert *= halfLambert;

    vec3 color = (halfLambert * vLightColor * lambertDiffuse(cDiff)) + specular;

    vec3 emissive = emissiveFactor;
    color += emissive;

    // gamma correction
    color = pow(color, vec3(1.0/2.2));

    outColor = vec4(color, baseColor.a);
  }`;

export class PBRShaderModule {
  constructor(device) {
    if (!glslang) { throw new Error('A call to PBRShaderModule.initGlslang() must be completed prior to constructing a new shader'); }

    this.vertexStage = {
      module: device.createShaderModule({
        code: glslang.compileGLSL(PBR_VERTEX_SOURCE, 'vertex')
      }),
      entryPoint: 'main'
    };

    this.fragmentStage = {
      module: device.createShaderModule({
        code: glslang.compileGLSL(PBR_FRAGMENT_SOURCE, 'fragment')
      }),
      entryPoint: 'main'
    };
  }

  static async initGlslang() {
    glslang = await glslangModule();
  }
}