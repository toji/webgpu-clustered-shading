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

export const SAMPLER_MAP = {
  baseColorTexture: 0,
  normalTexture: 1,
  metallicRoughnessTexture: 2,
  emissiveTexture: 3,
  occlusionTexture: 4
};

export const UNIFORM_BLOCKS = {
  FrameUniforms: 0,
  MaterialUniforms: 1,
  PrimitiveUniforms: 2
};

// These equations are borrowed with love from this doc from Epic because I
// just don't have anything novel to bring to the PBR scene.
// http://blog.selfshadow.com/publications/s2013-shading-course/karis/s2013_pbs_epic_notes_v2.pdf
const EPIC_PBR_FUNCTIONS = `
#define M_PI 3.14159265

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

const WEBGL_ATTRIBUTES = `
attribute vec3 POSITION;
attribute vec3 NORMAL;
attribute vec4 TANGENT;
attribute vec2 TEXCOORD_0;
attribute vec4 COLOR_0;
`;

const ATTRIBUTES_WITH_LAYOUT = `
layout(location = ${ATTRIB_MAP.POSITION}) in vec3 POSITION;
layout(location = ${ATTRIB_MAP.NORMAL}) in vec3 NORMAL;
#ifdef USE_NORMAL_MAP
layout(location = ${ATTRIB_MAP.TANGENT}) in vec4 TANGENT;
#endif
layout(location = ${ATTRIB_MAP.TEXCOORD_0}) in vec2 TEXCOORD_0;
#ifdef USE_VERTEX_COLOR
layout(location = ${ATTRIB_MAP.COLOR_0}) in vec4 COLOR_0;
#endif
`;

const WEBGL_VARYINGS = `
varying vec3 vLight; // Vector from vertex to light.
varying vec3 vLightColor;
varying vec3 vView; // Vector from vertex to camera.
varying vec2 vTex;
varying vec4 vCol;

#ifdef USE_NORMAL_MAP
varying mat3 vTBN;
#else
varying vec3 vNorm;
#endif
`;

function WEBGL2_VARYINGS(dir) {
  return `
${dir} vec3 vLight; // Vector from vertex to light.
${dir} vec3 vLightColor;
${dir} vec3 vView; // Vector from vertex to camera.
${dir} vec2 vTex;
${dir} vec4 vCol;

#ifdef USE_NORMAL_MAP
${dir} mat3 vTBN;
#else
${dir} vec3 vNorm;
#endif
`;
}

function WEBGPU_VARYINGS(dir) {
  return `
layout(location = 0) ${dir} vec3 vLight; // Vector from vertex to light.
layout(location = 1) ${dir} vec3 vLightColor;
layout(location = 2) ${dir} vec3 vView; // Vector from vertex to camera.
layout(location = 3) ${dir} vec2 vTex;
layout(location = 4) ${dir} vec4 vCol;

#ifdef USE_NORMAL_MAP
layout(location = 5) ${dir} mat3 vTBN;
#else
layout(location = 5) ${dir} vec3 vNorm;
#endif
`;
}

const WEBGL_VERTEX_UNIFORMS = `
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform vec3 lightDirection;
uniform vec3 lightColor;

uniform mat4 modelMatrix;
`;

const WEBGL2_VERTEX_UNIFORMS = `
layout(std140) uniform FrameUniforms
{
  mat4 projectionMatrix;
  mat4 viewMatrix;
  vec3 cameraPosition;
  vec3 lightDirection;
  vec3 lightColor;
};

uniform mat4 modelMatrix;
`;

const WEBGPU_VERTEX_UNIFORMS = `
layout(set = ${UNIFORM_BLOCKS.FrameUniforms}, binding = 0) uniform FrameUniforms {
  mat4 projectionMatrix;
  mat4 viewMatrix;
  vec3 cameraPosition;
  vec3 lightDirection;
  vec3 lightColor;
};

layout(set = ${UNIFORM_BLOCKS.PrimitiveUniforms}, binding = 0) uniform PrimitiveUniforms {
  mat4 modelMatrix;
};
`;

const WEBGL_FRAGMENT_UNIFORMS = `
uniform vec4 baseColorFactor;
uniform vec2 metallicRoughnessFactor;
uniform vec3 emissiveFactor;
uniform float occlusionStrength;

uniform sampler2D baseColorTexture;
uniform sampler2D normalTexture;
uniform sampler2D metallicRoughnessTexture;
uniform sampler2D occlusionTexture;
uniform sampler2D emissiveTexture;
`;

const WEBGL2_FRAGMENT_UNIFORMS = `
layout(std140) uniform MaterialUniforms {
  vec4 baseColorFactor;
  vec2 metallicRoughnessFactor;
  vec3 emissiveFactor;
  float occlusionStrength;
};

uniform sampler2D baseColorTexture;
uniform sampler2D normalTexture;
uniform sampler2D metallicRoughnessTexture;
uniform sampler2D occlusionTexture;
uniform sampler2D emissiveTexture;
`;

const WEBGPU_FRAGMENT_UNIFORMS = `
layout(set = ${UNIFORM_BLOCKS.MaterialUniforms}, binding = 0) uniform MaterialUniforms {
  vec4 baseColorFactor;
  vec2 metallicRoughnessFactor;
  vec3 emissiveFactor;
  float occlusionStrength;
};

layout(set = 1, binding = 1) uniform sampler defaultSampler;

layout(set = 1, binding = 2) uniform texture2D baseColorTexture;
layout(set = 1, binding = 3) uniform texture2D normalTexture;
layout(set = 1, binding = 4) uniform texture2D metallicRoughnessTexture;
layout(set = 1, binding = 5) uniform texture2D occlusionTexture;
layout(set = 1, binding = 6) uniform texture2D emissiveTexture;
`;

function WEBGL_TEXTURE(texture, texcoord) {
  return `texture2D(${texture}, ${texcoord})`;
}

function WEBGL2_TEXTURE(texture, texcoord) {
  return `texture(${texture}, ${texcoord})`;
}

function WEBGPU_TEXTURE(texture, texcoord) {
  return `texture(sampler2D(${texture}, defaultSampler), ${texcoord})`;
}

const PBR_VERTEX_MAIN = `
void main() {
  vec3 n = normalize(vec3(modelMatrix * vec4(NORMAL, 0.0)));
#ifdef USE_NORMAL_MAP
  vec3 t = normalize(vec3(modelMatrix * vec4(TANGENT.xyz, 0.0)));
  vec3 b = cross(n, t) * TANGENT.w;
  vTBN = mat3(t, b, n);
#else
  vNorm = n;
#endif

#ifdef USE_VERTEX_COLOR
  vCol = COLOR_0;
#endif

  vTex = TEXCOORD_0;
  vec4 mPos = modelMatrix * vec4(POSITION, 1.0);
  vLight = -lightDirection;
  vLightColor = lightColor;
  vView = cameraPosition - mPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * mPos;
}`;

function PBR_FRAGMENT_MAIN(textureFunc) {
  return `
${EPIC_PBR_FUNCTIONS}

const vec3 dielectricSpec = vec3(0.04);
const vec3 black = vec3(0.0);

vec4 computeColor() {
#ifdef USE_BASE_COLOR_MAP
  vec4 baseColor = ${textureFunc('baseColorTexture', 'vTex')} * baseColorFactor;
#else
  vec4 baseColor = baseColorFactor;
#endif

#ifdef USE_VERTEX_COLOR
  baseColor *= vCol;
#endif

#ifdef USE_NORMAL_MAP
  vec3 n = ${textureFunc('normalTexture', 'vTex')}.rgb;
  n = normalize(vTBN * (2.0 * n - 1.0));
#else
  vec3 n = normalize(vNorm);
#endif

#ifdef FULLY_ROUGH
  float metallic = 0.0;
#else
  float metallic = metallicRoughnessFactor.x;
#endif

  float roughness = metallicRoughnessFactor.y;

#ifdef USE_METAL_ROUGH_MAP
  vec4 metallicRoughness = ${textureFunc('metallicRoughnessTexture', 'vTex')};
  metallic *= metallicRoughness.b;
  roughness *= metallicRoughness.g;
#endif

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

#ifdef FULLY_ROUGH
  vec3 specular = F0 * 0.45;
#else
  vec3 F = specF(vDotH, F0);
  float D = specD(a, nDotH);
  float G = specG(roughness, nDotL, nDotV);
  vec3 specular = (D * F * G) / (4.0 * nDotL * nDotV);
#endif
  float halfLambert = dot(n, l) * 0.5 + 0.5;
  halfLambert *= halfLambert;

  vec3 color = (halfLambert * vLightColor * lambertDiffuse(cDiff)) + specular;

#ifdef USE_OCCLUSION
  float occlusion = ${textureFunc('occlusionTexture', 'vTex')}.r;
  color = mix(color, color * occlusion, occlusionStrength);
#endif

  vec3 emissive = emissiveFactor;
#ifdef USE_EMISSIVE_TEXTURE
  emissive *= ${textureFunc('emissiveTexture', 'vTex')}.rgb;
#endif
  color += emissive;

  // tone mapping and gamma correction
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0/2.2));

  return vec4(color, baseColor.a);
}`;
};

function DEFINES(defines = {}) {
  let definesString = '';
  for (let define in defines) {
    definesString += `#define ${define} ${defines[define]}\n`;
  }
  return definesString;
}

export function WEBGL_VERTEX_SOURCE(defines) {
  return `
  ${DEFINES(defines)}
  ${WEBGL_ATTRIBUTES}
  ${WEBGL_VARYINGS}
  ${WEBGL_VERTEX_UNIFORMS}
  ${PBR_VERTEX_MAIN}
  `;
}

export function WEBGL_FRAGMENT_SOURCE(defines) {
  return `precision highp float;
  ${DEFINES(defines)}
  ${WEBGL_VARYINGS}
  ${WEBGL_FRAGMENT_UNIFORMS}
  ${PBR_FRAGMENT_MAIN(WEBGL_TEXTURE)}

  void main() {
    gl_FragColor = computeColor();
  }
  `;
}

export function WEBGL2_VERTEX_SOURCE(defines) {
  return `#version 300 es
  ${DEFINES(defines)}
  ${ATTRIBUTES_WITH_LAYOUT}
  ${WEBGL2_VARYINGS('out')}
  ${WEBGL2_VERTEX_UNIFORMS}
  ${PBR_VERTEX_MAIN}
  `;
}

export function WEBGL2_FRAGMENT_SOURCE(defines) {
  return `#version 300 es
  precision highp float;
  ${DEFINES(defines)}
  ${WEBGL2_VARYINGS('in')}
  ${WEBGL2_FRAGMENT_UNIFORMS}
  ${PBR_FRAGMENT_MAIN(WEBGL2_TEXTURE)}

  out vec4 outputColor;
  void main() {
    outputColor = computeColor();
  }
  `;
}

export function WEBGPU_VERTEX_SOURCE(defines) {
  return `#version 450
  ${DEFINES(defines)}
  ${ATTRIBUTES_WITH_LAYOUT}
  ${WEBGPU_VARYINGS('out')}
  ${WEBGPU_VERTEX_UNIFORMS}
  ${PBR_VERTEX_MAIN}
  `;
}

export function WEBGPU_FRAGMENT_SOURCE(defines) {
  return `#version 450
  precision highp float;
  ${DEFINES(defines)}
  ${WEBGPU_VARYINGS('in')}
  ${WEBGPU_FRAGMENT_UNIFORMS}
  ${PBR_FRAGMENT_MAIN(WEBGPU_TEXTURE)}

  layout(location = 0) out vec4 outputColor;
  void main() {
    outputColor = computeColor();
  }
  `;
}

export function GetDefinesForPrimitive(primitive) {
  const attributes = primitive.enabledAttributes;
  const material = primitive.material;
  const programDefines = {};

  if (attributes.has('COLOR_0')) {
    programDefines['USE_VERTEX_COLOR'] = 1;
  }

  if (attributes.has('TEXCOORD_0')) {
    if (material.baseColorTexture) {
      programDefines['USE_BASE_COLOR_MAP'] = 1;
    }

    if (material.normalTexture && (attributes.has('TANGENT'))) {
      programDefines['USE_NORMAL_MAP'] = 1;
    }

    if (material.metallicRoughnessTexture) {
      programDefines['USE_METAL_ROUGH_MAP'] = 1;
    }

    if (material.occlusionTexture) {
      programDefines['USE_OCCLUSION'] = 1;
    }

    if (material.emissiveTexture) {
      programDefines['USE_EMISSIVE_TEXTURE'] = 1;
    }
  }

  if ((!material.metallicRoughnessTexture ||
        !(attributes.has('TEXCOORD_0'))) &&
        material.metallicRoughnessFactor[1] == 1.0) {
    programDefines['FULLY_ROUGH'] = 1;
  }

  return programDefines;
}
