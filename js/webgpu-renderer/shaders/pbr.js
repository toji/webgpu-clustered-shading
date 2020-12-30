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

import { ProjectionUniforms, ViewUniforms, ModelUniforms, LightUniforms, MaterialUniforms, ATTRIB_MAP } from '../shaders/common.js';
import { ClusterLightsStructs, TileFunctions } from '../shaders/clustered-compute.js';

function PBR_VARYINGS(defines, dir) { return `
[[location(0)]] var<${dir}> vWorldPos : vec3<f32>;
[[location(1)]] var<${dir}> vView : vec3<f32>; # Vector from vertex to camera.
[[location(2)]] var<${dir}> vTex : vec2<f32>;
[[location(3)]] var<${dir}> vCol : vec4<f32>;

${defines.USE_NORMAL_MAP ? `
[[location(4)]] var<${dir}> vTBN : mat3x3<f32>;
` : `
[[location(4)]] var<${dir}> vNorm : vec3<f32>;
`}`;
}

export function PBRVertexSource(defines) { return `
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${ModelUniforms}

  ${PBR_VARYINGS(defines, 'out')}

  [[location(${ATTRIB_MAP.POSITION})]] var<in> POSITION : vec3<f32>;
  [[location(${ATTRIB_MAP.NORMAL})]] var<in> NORMAL : vec3<f32>;
  ${defines.USE_NORMAL_MAP ? `
  [[location(${ATTRIB_MAP.TANGENT})]] var<in> TANGENT : vec4<f32>;
  ` : ``}
  [[location(${ATTRIB_MAP.TEXCOORD_0})]] var<in> TEXCOORD_0 : vec2<f32>;
  ${defines.USE_VERTEX_COLOR ? `
  [[location(${ATTRIB_MAP.COLOR_0})]] var<in> COLOR_0 : vec4<f32>;
  ` : ``}

  [[builtin(position)]] var<out> outPosition : vec4<f32>;

  [[stage(vertex)]]
  fn main() -> void {
    var n : vec3<f32> = normalize((model.matrix * vec4<f32>(NORMAL, 0.0)).xyz);
  ${defines.USE_NORMAL_MAP ? `
    var t : vec3<f32> = normalize((model.matrix * vec4<f32>(TANGENT.xyz, 0.0)).xyz);
    var b : vec3<f32> = cross(n, t) * TANGENT.w;
    vTBN = mat3x3<f32>(t, b, n);
  ` : `
    vNorm = n;
  `}

  ${defines.USE_VERTEX_COLOR ? `
    vCol = COLOR_0;
  ` : `` }

    vTex = TEXCOORD_0;
    var mPos : vec4<f32> = model.matrix * vec4<f32>(POSITION, 1.0);
    vWorldPos = mPos.xyz;
    vView = view.position - mPos.xyz;
    outPosition = projection.matrix * view.matrix * mPos;
    return;
  }`;
}

function ReadPBRInputs(defines) { return `
  var baseColor : vec4<f32> = material.baseColorFactor;
${defines.USE_BASE_COLOR_MAP ? `
  var baseColorMap : vec4<f32> = textureSample(baseColorTexture, defaultSampler, vTex);
  if (baseColorMap.a < 0.05) {
    discard;
  }
  baseColor = baseColor * baseColorMap;
` : ``}
${defines.USE_VERTEX_COLOR ? `
  baseColor = baseColor * vCol;
` : ``}

  var albedo : vec3<f32> = baseColor.rgb;

  var metallic : f32 = material.metallicRoughnessFactor.x;
  var roughness : f32 = material.metallicRoughnessFactor.y;

${defines.USE_METAL_ROUGH_MAP ? `
  var metallicRoughness : vec4<f32> = textureSample(metallicRoughnessTexture, defaultSampler, vTex);
  metallic = metallic * metallicRoughness.b;
  roughness = roughness * metallicRoughness.g;
` : ``}

${defines.USE_NORMAL_MAP ? `
  var N : vec3<f32> = textureSample(normalTexture, defaultSampler, vTex).rgb;
  N = normalize(vTBN * (2.0 * N - vec3<f32>(1.0, 1.0, 1.0)));
` : `
  var N : vec3<f32> = normalize(vNorm);
`}

  var V : vec3<f32> = normalize(vView);

  const dielectricSpec : vec3<f32> = vec3<f32>(0.04, 0.04, 0.04);
  var F0 : vec3<f32> = mix(dielectricSpec, albedo, vec3<f32>(metallic, metallic, metallic));

${defines.USE_OCCLUSION ? `
  var ao : f32 = textureSample(occlusionTexture, defaultSampler, vTex).r * material.occlusionStrength;
` : `
  var ao : f32 = 1.0;
`}

  var emissive : vec3<f32> = material.emissiveFactor;
${defines.USE_EMISSIVE_TEXTURE ? `
  emissive = emissive * textureSample(emissiveTexture, defaultSampler, vTex).rgb;
` : ``}

  var ambient : vec3<f32> = light.lightAmbient * albedo * ao;
`; }

// Much of the shader used here was pulled from https://learnopengl.com/PBR/Lighting
// Thanks!
const PBRFunctions = `
const PI : f32 = 3.14159265359;

fn FresnelSchlick(cosTheta : f32, F0 : vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0, 1.0, 1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

fn DistributionGGX(N : vec3<f32>, H : vec3<f32>, roughness : f32) -> f32 {
  var a : f32      = roughness*roughness;
  var a2 : f32     = a*a;
  var NdotH : f32  = max(dot(N, H), 0.0);
  var NdotH2 : f32 = NdotH*NdotH;

  var num : f32    = a2;
  var denom : f32  = (NdotH2 * (a2 - 1.0) + 1.0);
  denom = PI * denom * denom;

  return num / denom;
}

fn GeometrySchlickGGX(NdotV : f32, roughness : f32) -> f32 {
  var r : f32 = (roughness + 1.0);
  var k : f32 = (r*r) / 8.0;

  var num : f32   = NdotV;
  var denom : f32 = NdotV * (1.0 - k) + k;

  return num / denom;
}

fn GeometrySmith(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, roughness : f32) -> f32 {
  var NdotV : f32 = max(dot(N, V), 0.0);
  var NdotL : f32 = max(dot(N, L), 0.0);
  var ggx2 : f32  = GeometrySchlickGGX(NdotV, roughness);
  var ggx1 : f32  = GeometrySchlickGGX(NdotL, roughness);

  return ggx1 * ggx2;
}`;

const RadianceFunction = `
${PBRFunctions}

fn lightRadiance(i : i32, V : vec3<f32>, N : vec3<f32>, albedo : vec3<f32>, metallic : f32, roughness : f32, F0 : vec3<f32>) -> vec3<f32> {
  var L : vec3<f32> = normalize(light.lights[i].position.xyz - vWorldPos);
  var H : vec3<f32> = normalize(V + L);
  var distance : f32 = length(light.lights[i].position.xyz - vWorldPos);

  var lightRange : f32 = light.lights[i].range;
  var attenuation : f32 = pow(clamp(1.0 - pow((distance / lightRange), 4.0), 0.0, 1.0), 2.0)/(1.0  + (distance * distance));
  # var attenuation : f32 = 1.0 / (1.0 + distance * distance);
  var radiance : vec3<f32> = light.lights[i].color.rgb * attenuation;

  # cook-torrance brdf
  var NDF : f32 = DistributionGGX(N, H, roughness);
  var G : f32 = GeometrySmith(N, V, L, roughness);
  var F : vec3<f32> = FresnelSchlick(max(dot(H, V), 0.0), F0);

  var kD : vec3<f32> = vec3<f32>(1.0, 1.0, 1.0) - F;
  kD = kD * (1.0 - metallic);

  var numerator : vec3<f32>    = NDF * G * F;
  var denominator : f32 = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0);
  denominator = max(denominator, 0.001);
  var specular : vec3<f32>     = numerator / vec3<f32>(denominator, denominator, denominator);

  # add to outgoing radiance Lo
  var NdotL : f32 = max(dot(N, L), 0.0);
  return (kD * albedo / vec3<f32>(PI, PI, PI) + specular) * radiance * NdotL;
}
`;

export function PBRFragmentSource(defines) { return `
  ${LightUniforms(defines.maxLights)}
  ${MaterialUniforms}

  ${RadianceFunction}

  ${PBR_VARYINGS(defines, 'in')}

  [[location(0)]] var<out> outColor : vec4<f32>;

  [[stage(fragment)]]
  fn main() -> void {
    ${ReadPBRInputs(defines)}

    # reflectance equation
    var Lo : vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

    for (var i : i32 = 0; i < light.lightCount; i = i + 1) {
      # calculate per-light radiance and add to outgoing radiance Lo
      Lo = Lo + lightRadiance(i, V, N, albedo, metallic, roughness, F0);
    }

    var color : vec3<f32> = Lo + ambient + emissive;
    color = color / (color + vec3<f32>(1.0, 1.0, 1.0));
    color = pow(color, vec3<f32>(1.0/2.2, 1.0/2.2, 1.0/2.2));

    outColor = vec4<f32>(color, baseColor.a);
    return;
  }`;
}

export function PBRClusteredFragmentSource(defines) { return `
  ${ProjectionUniforms}
  ${ClusterLightsStructs}
  ${MaterialUniforms}
  ${LightUniforms(defines.maxLights)}

  ${TileFunctions}
  ${RadianceFunction}

  ${PBR_VARYINGS(defines, 'in')}

  [[builtin(frag_coord)]] var<in> fragCoord : vec4<f32>;
  [[location(0)]] var<out> outColor : vec4<f32>;

  [[stage(fragment)]]
  fn main() -> void {
    ${ReadPBRInputs(defines)}

    # reflectance equation
    var Lo : vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

    var clusterIndex : i32 = getClusterIndex(fragCoord);
    var lightCount : i32 = clusterLights.lights[clusterIndex].count;

    for (var lightIndex : i32 = 0; lightIndex < lightCount; lightIndex = lightIndex + 1) {
      var i : i32 = clusterLights.lights[clusterIndex].indices[lightIndex];

      # calculate per-light radiance and add to outgoing radiance Lo
      Lo = Lo + lightRadiance(i, V, N, albedo, metallic, roughness, F0);
    }

    var color : vec3<f32> = Lo + ambient + emissive;
    color = color / (color + vec3<f32>(1.0, 1.0, 1.0));
    color = pow(color, vec3<f32>(1.0/2.2, 1.0/2.2, 1.0/2.2));

    outColor = vec4<f32>(color, baseColor.a);
    return;
  }`;
};