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
  PrimitiveUniforms: 2,
  LightUniforms: 3
};

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
varying vec3 vWorldPos;
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
${dir} vec3 vWorldPos;
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
layout(location = 0) ${dir} vec3 vWorldPos;
layout(location = 1) ${dir} vec3 vView; // Vector from vertex to camera.
layout(location = 2) ${dir} vec2 vTex;
layout(location = 3) ${dir} vec4 vCol;

#ifdef USE_NORMAL_MAP
layout(location = 4) ${dir} mat3 vTBN;
#else
layout(location = 4) ${dir} vec3 vNorm;
#endif
`;
}

const WEBGL_VERTEX_UNIFORMS = `
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;

uniform mat4 modelMatrix;
`;

const WEBGL2_VERTEX_UNIFORMS = `
layout(std140) uniform FrameUniforms
{
  mat4 projectionMatrix;
  mat4 viewMatrix;
  vec3 cameraPosition;
};

uniform mat4 modelMatrix;
`;

const WEBGPU_VERTEX_UNIFORMS = `
layout(set = ${UNIFORM_BLOCKS.FrameUniforms}, binding = 0) uniform FrameUniforms {
  mat4 projectionMatrix;
  mat4 viewMatrix;
  vec3 cameraPosition;
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

uniform vec3 lightPosition;
uniform vec3 lightColor;
uniform float lightAttenuation; // Quadratic
uniform float lightAmbient;
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

struct Light {
  vec3 lightPosition;
  vec3 lightColor;
  float lightAttenuation; // Quadratic
};

layout(std140) uniform LightUniforms {
  Light lights[LIGHT_COUNT];
  float lightAmbient;
};
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

layout(set = ${UNIFORM_BLOCKS.LightUniforms}, binding = 0) uniform LightUniforms {
  vec3 lightPosition;
  vec3 lightColor;
  float lightAttenuation; // Quadratic
  float lightAmbient;
};
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

// Much of the shader used here was pulled from https://learnopengl.com/PBR/Lighting
// Thanks!
const PBR_FUNCTIONS = `
const float PI = 3.14159265359;

vec3 FresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

float DistributionGGX(vec3 N, vec3 H, float roughness) {
    float a      = roughness*roughness;
    float a2     = a*a;
    float NdotH  = max(dot(N, H), 0.0);
    float NdotH2 = NdotH*NdotH;

    float num   = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;

    return num / denom;
}

float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r*r) / 8.0;

    float num   = NdotV;
    float denom = NdotV * (1.0 - k) + k;

    return num / denom;
}

float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2  = GeometrySchlickGGX(NdotV, roughness);
    float ggx1  = GeometrySchlickGGX(NdotL, roughness);

    return ggx1 * ggx2;
}`;

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
  vWorldPos = mPos.xyz;
  vView = cameraPosition - mPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * mPos;
}`;

function PBR_FRAGMENT_MAIN(textureFunc) {
  return `
${PBR_FUNCTIONS}

const vec3 dielectricSpec = vec3(0.04);
const vec3 black = vec3(0.0);

vec4 computeColor() {
  vec4 baseColor = baseColorFactor;
#ifdef USE_BASE_COLOR_MAP
  baseColor *= ${textureFunc('baseColorTexture', 'vTex')};
#endif
#ifdef USE_VERTEX_COLOR
  baseColor *= vCol;
#endif

  if (baseColor.a < 0.05) {
    discard;
  }

  vec3 albedo = baseColor.rgb; //pow(baseColor.rgb, 2.2);

  float metallic = metallicRoughnessFactor.x;
  float roughness = metallicRoughnessFactor.y;

#ifdef USE_METAL_ROUGH_MAP
  vec4 metallicRoughness = ${textureFunc('metallicRoughnessTexture', 'vTex')};
  metallic *= metallicRoughness.b;
  roughness *= metallicRoughness.g;
#endif

#ifdef USE_NORMAL_MAP
  vec3 N = ${textureFunc('normalTexture', 'vTex')}.rgb;
  N = normalize(vTBN * (2.0 * N - 1.0));
#else
  vec3 N = normalize(vNorm);
#endif

  vec3 V = normalize(vView);

  vec3 F0 = vec3(0.04);
  F0 = mix(F0, albedo, metallic);

  // reflectance equation
  vec3 Lo = vec3(0.0);

  for (int i = 0; i < LIGHT_COUNT; ++i) {
    if (lights[i].lightAttenuation == 0.0) {
      continue; // Skip lights that don't have properly initialized data
    }

    // calculate per-light radiance
    vec3 L = normalize(lights[i].lightPosition - vWorldPos);
    vec3 H = normalize(V + L);
    float distance    = length(lights[i].lightPosition - vWorldPos);
    float attenuation = 1.0 / (lights[i].lightAttenuation * (distance * distance));
    vec3 radiance     = lights[i].lightColor * attenuation;

    // cook-torrance brdf
    float NDF = DistributionGGX(N, H, roughness);
    float G   = GeometrySmith(N, V, L, roughness);
    vec3 F    = FresnelSchlick(max(dot(H, V), 0.0), F0);

    vec3 kS = F;
    vec3 kD = vec3(1.0) - kS;
    kD *= 1.0 - metallic;

    vec3 numerator    = NDF * G * F;
    float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0);
    vec3 specular     = numerator / max(denominator, 0.001);

    // add to outgoing radiance Lo
    float NdotL = max(dot(N, L), 0.0);
    Lo += (kD * albedo / PI + specular) * radiance * NdotL;
  }

#ifdef USE_OCCLUSION
  float ao = ${textureFunc('occlusionTexture', 'vTex')}.r * occlusionStrength;
#else
  float ao = 1.0;
#endif

  vec3 ambient = vec3(lightAmbient) * albedo * ao;
  vec3 color = ambient + Lo;

  vec3 emissive = emissiveFactor;
#ifdef USE_EMISSIVE_TEXTURE
  emissive *= ${textureFunc('emissiveTexture', 'vTex')}.rgb;
#endif
  color += emissive;

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
