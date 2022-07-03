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

import { wgsl } from '../wgsl-debug-helper.js';
import { ProjectionUniforms, ViewUniforms, ModelUniforms, LightUniforms, MaterialUniforms, ColorConversions, ATTRIB_MAP } from '../shaders/common.js';
import { ClusterLightsStructs, TileFunctions } from '../shaders/clustered-compute.js';

function PBR_VARYINGS(defines) { return wgsl`
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) view : vec3<f32>, // Vector from vertex to camera.
  @location(2) texCoord : vec2<f32>,
  @location(3) color : vec4<f32>,
  @location(4) normal : vec3<f32>,

#if ${defines.USE_NORMAL_MAP}
  @location(5) tangent : vec3<f32>,
  @location(6) bitangent : vec3<f32>,
#endif
};
`;
}

export function PBRVertexSource(defines) { return wgsl`
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${ModelUniforms}

  struct VertexInputs {
    @location(${ATTRIB_MAP.POSITION}) position : vec3<f32>,
    @location(${ATTRIB_MAP.NORMAL}) normal : vec3<f32>,
    @location(${ATTRIB_MAP.TEXCOORD_0}) texCoord : vec2<f32>,
#if ${defines.USE_NORMAL_MAP}
    @location(${ATTRIB_MAP.TANGENT}) tangent : vec4<f32>,
#endif
#if ${defines.USE_VERTEX_COLOR}
    @location(${ATTRIB_MAP.COLOR_0}) color : vec4<f32>,
#endif
  };

  ${PBR_VARYINGS(defines)}

  @vertex
  fn main(input : VertexInputs) -> VertexOutput {
    var output : VertexOutput;
    output.normal = normalize((model.matrix * vec4<f32>(input.normal, 0.0)).xyz);

#if ${defines.USE_NORMAL_MAP}
    output.tangent = normalize((model.matrix * vec4<f32>(input.tangent.xyz, 0.0)).xyz);
    output.bitangent = cross(output.normal, output.tangent) * input.tangent.w;
#endif

#if ${defines.USE_VERTEX_COLOR}
    output.color = input.color;
#else
    output.color = vec4<f32>(1.0, 1.0, 1.0, 1.0);
#endif

    output.texCoord = input.texCoord;
    let modelPos = model.matrix * vec4<f32>(input.position, 1.0);
    output.worldPos = modelPos.xyz;
    output.view = view.position - modelPos.xyz;
    output.position = projection.matrix * view.matrix * modelPos;
    return output;
  }`;
}

function PBRSurfaceInfo(defines) { return wgsl`
  ${PBR_VARYINGS(defines)}

  struct SurfaceInfo {
    baseColor : vec4<f32>,
    albedo : vec3<f32>,
    metallic : f32,
    roughness : f32,
    normal : vec3<f32>,
    f0 : vec3<f32>,
    ao : f32,
    emissive : vec3<f32>,
    v : vec3<f32>
  };

  fn GetSurfaceInfo(input : VertexOutput) -> SurfaceInfo {
    var surface : SurfaceInfo;
    surface.v = normalize(input.view);

    surface.baseColor = material.baseColorFactor * input.color;
#if ${defines.USE_BASE_COLOR_MAP}
    let baseColorMap = textureSample(baseColorTexture, defaultSampler, input.texCoord);
    surface.baseColor = surface.baseColor * baseColorMap;
#endif

    surface.albedo = surface.baseColor.rgb;

    surface.metallic = material.metallicRoughnessFactor.x;
    surface.roughness = material.metallicRoughnessFactor.y;

#if ${defines.USE_METAL_ROUGH_MAP}
    let metallicRoughness = textureSample(metallicRoughnessTexture, defaultSampler, input.texCoord);
    surface.metallic = surface.metallic * metallicRoughness.b;
    surface.roughness = surface.roughness * metallicRoughness.g;
#endif

#if ${defines.USE_NORMAL_MAP}
    let tbn = mat3x3<f32>(input.tangent, input.bitangent, input.normal);
    let N = textureSample(normalTexture, defaultSampler, input.texCoord).rgb;
    surface.normal = normalize(tbn * (2.0 * N - vec3<f32>(1.0, 1.0, 1.0)));
#else
    surface.normal = normalize(input.normal);
#endif

    let dielectricSpec = vec3<f32>(0.04, 0.04, 0.04);
    surface.f0 = mix(dielectricSpec, surface.albedo, vec3<f32>(surface.metallic, surface.metallic, surface.metallic));

#if ${defines.USE_OCCLUSION}
    surface.ao = textureSample(occlusionTexture, defaultSampler, input.texCoord).r * material.occlusionStrength;
#else
    surface.ao = 1.0;
#endif

    surface.emissive = material.emissiveFactor;
#if ${defines.USE_EMISSIVE_TEXTURE}
    surface.emissive = surface.emissive * textureSample(emissiveTexture, defaultSampler, input.texCoord).rgb;
#endif

    return surface;
  }
`; }

// Much of the shader used here was pulled from https://learnopengl.com/PBR/Lighting
// Thanks!
const PBRFunctions = `
const PI = ${Math.PI};

const LightType_Point = 0u;
const LightType_Spot = 1u;
const LightType_Directional = 2u;

struct PuctualLight {
  lightType : u32,
  pointToLight : vec3<f32>,
  range : f32,
  color : vec3<f32>,
  intensity : f32
};

fn FresnelSchlick(cosTheta : f32, F0 : vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0, 1.0, 1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

fn DistributionGGX(N : vec3<f32>, H : vec3<f32>, roughness : f32) -> f32 {
  let a      = roughness*roughness;
  let a2     = a*a;
  let NdotH  = max(dot(N, H), 0.0);
  let NdotH2 = NdotH*NdotH;

  let num    = a2;
  let denom  = (NdotH2 * (a2 - 1.0) + 1.0);

  return num / (PI * denom * denom);
}

fn GeometrySchlickGGX(NdotV : f32, roughness : f32) -> f32 {
  let r = (roughness + 1.0);
  let k = (r*r) / 8.0;

  let num   = NdotV;
  let denom = NdotV * (1.0 - k) + k;

  return num / denom;
}

fn GeometrySmith(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, roughness : f32) -> f32 {
  let NdotV = max(dot(N, V), 0.0);
  let NdotL = max(dot(N, L), 0.0);
  let ggx2  = GeometrySchlickGGX(NdotV, roughness);
  let ggx1  = GeometrySchlickGGX(NdotL, roughness);

  return ggx1 * ggx2;
}

fn rangeAttenuation(range : f32, distance : f32) -> f32 {
  if (range <= 0.0) {
      // Negative range means no cutoff
      return 1.0 / pow(distance, 2.0);
  }
  return clamp(1.0 - pow(distance / range, 4.0), 0.0, 1.0) / pow(distance, 2.0);
}

fn lightRadiance(light : PuctualLight, surface : SurfaceInfo) -> vec3<f32> {
  let L = normalize(light.pointToLight);
  let H = normalize(surface.v + L);
  let distance = length(light.pointToLight);

  // cook-torrance brdf
  let NDF = DistributionGGX(surface.normal, H, surface.roughness);
  let G = GeometrySmith(surface.normal, surface.v, L, surface.roughness);
  let F = FresnelSchlick(max(dot(H, surface.v), 0.0), surface.f0);

  let kD = (vec3<f32>(1.0, 1.0, 1.0) - F) * (1.0 - surface.metallic);

  let NdotL = max(dot(surface.normal, L), 0.0);

  let numerator = NDF * G * F;
  let denominator = max(4.0 * max(dot(surface.normal, surface.v), 0.0) * NdotL, 0.001);
  let specular = numerator / vec3<f32>(denominator, denominator, denominator);

  // add to outgoing radiance Lo
  let attenuation = rangeAttenuation(light.range, distance);
  let radiance = light.color * light.intensity * attenuation;
  return (kD * surface.albedo / vec3<f32>(PI, PI, PI) + specular) * radiance * NdotL;
}`;

export function PBRClusteredFragmentSource(defines) { return `
  ${ColorConversions}
  ${ProjectionUniforms}
  ${ClusterLightsStructs}
  ${MaterialUniforms}
  ${LightUniforms}
  ${TileFunctions}

  ${PBRSurfaceInfo(defines)}
  ${PBRFunctions}

  @fragment
  fn main(input : VertexOutput) -> @location(0) vec4<f32> {
    let surface = GetSurfaceInfo(input);
    if (surface.baseColor.a < 0.05) {
      discard;
    }

    // reflectance equation
    var Lo = vec3<f32>(0.0, 0.0, 0.0);

    let clusterIndex = getClusterIndex(input.position);
    let lightOffset  = clusterLights.lights[clusterIndex].offset;
    let lightCount   = clusterLights.lights[clusterIndex].count;

    for (var lightIndex = 0u; lightIndex < lightCount; lightIndex = lightIndex + 1u) {
      let i = clusterLights.indices[lightOffset + lightIndex];

      var light : PuctualLight;
      light.lightType = LightType_Point;
      light.pointToLight = globalLights.lights[i].position.xyz - input.worldPos;
      light.range = globalLights.lights[i].range;
      light.color = globalLights.lights[i].color;
      light.intensity = 1.0;

      // calculate per-light radiance and add to outgoing radiance Lo
      Lo = Lo + lightRadiance(light, surface);
    }

    let ambient = globalLights.ambient * surface.albedo * surface.ao;
    let color = linearTosRGB(Lo + ambient + surface.emissive);
    return vec4<f32>(color, surface.baseColor.a);
  }`;
};

export function PBRFragmentSource(defines) { return `
  ${ColorConversions}
  ${LightUniforms}
  ${MaterialUniforms}

  ${PBRSurfaceInfo(defines)}
  ${PBRFunctions}

  @fragment
  fn main(input : VertexOutput) -> @location(0) vec4<f32> {
    let surface = GetSurfaceInfo(input);

    // reflectance equation
    var Lo = vec3<f32>(0.0, 0.0, 0.0);

    for (var i = 0u; i < globalLights.lightCount; i = i + 1u) {
      var light : PuctualLight;
      light.lightType = LightType_Point;
      light.pointToLight = globalLights.lights[i].position.xyz - input.worldPos;
      light.range = globalLights.lights[i].range;
      light.color = globalLights.lights[i].color;
      light.intensity = 1.0;

      // calculate per-light radiance and add to outgoing radiance Lo
      Lo = Lo + lightRadiance(light, surface);
    }

    let ambient = globalLights.ambient * surface.albedo * surface.ao;
    let color = linearTosRGB(Lo + ambient + surface.emissive);
    return vec4<f32>(color, surface.baseColor.a);
  }`;
}