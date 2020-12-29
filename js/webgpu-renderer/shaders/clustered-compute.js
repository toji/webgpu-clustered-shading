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

// Lots of this derived from http://www.aortiz.me/2018/12/21/CG.html and
// https://github.com/Angelo1211/HybridRenderingEngine

import { FrameUniforms, LightUniforms, UNIFORM_SET } from './common.js';

export const TILE_COUNT = [16, 9, 24];
export const TOTAL_TILES = TILE_COUNT[0] * TILE_COUNT[1] * TILE_COUNT[2];

export const MAX_LIGHTS_PER_CLUSTER = 20;
export const CLUSTER_LIGHTS_SIZE = (4 * MAX_LIGHTS_PER_CLUSTER) + 4; // Each cluster tracks up to 10 light indices (ints) and one lght count

export const TileFunctions = `
const tileCount : vec3<i32> = vec3<i32>(${TILE_COUNT[0]}, ${TILE_COUNT[1]}, ${TILE_COUNT[2]});

fn linearDepth(depthSample : f32) -> f32 {
  var linear : f32 = 2.0 * frame.zNear * frame.zFar / (frame.zFar + frame.zNear - depthSample * (frame.zFar - frame.zNear));
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

// Trying something possibly very silly here: I'm going to store the cluster bounds as spheres
// (center + radius) instead of AABBs to reduce storage/intersection complexity. This will result
// in more overlap between clusters to ensure we don't have any gaps, and that may not be a good
// tradeoff, but I'll give it a try and see where the bottlenecks are.
export const ClusterStructs = `
  [[block]] struct ClusterBounds {
    [[offset(0)]] center : vec3<f32>;
    [[offset(12)]] radius : f32;
  };
  [[block]] struct Clusters {
    [[offset(0)]] bounds : [[stride(16)]] array<ClusterBounds, ${TOTAL_TILES}>;
  };
`;

export const ClusterLightsStructs = `
  [[block]] struct ClusterLights {
    [[offset(0)]] count : i32;
    [[offset(4)]] indices : [[stride(4)]] array<i32, ${MAX_LIGHTS_PER_CLUSTER}>;
  };
  [[block]] struct ClusterLightGroup {
    [[offset(0)]] lights : [[stride(${CLUSTER_LIGHTS_SIZE})]] array<ClusterLights, ${TOTAL_TILES}>;
  };
  [[set(${UNIFORM_SET.Frame}), binding(2)]] var<storage_buffer> clusterLights : ClusterLightGroup;
`;

export const ClusterBoundsSource = `
  ${FrameUniforms}
  ${ClusterStructs}
  [[set(1), binding(0)]] var<storage_buffer> clusters : Clusters;

  [[builtin(global_invocation_id)]] var<in> global_id : vec3<u32>;

  # THIS CRASHES:
  # [[set(1), binding(0)]] var<storage_buffer> clusters : [[stride(32)]] array<Cluster, ${TOTAL_TILES}>;

  fn lineIntersectionToZPlane(a : vec3<f32>, b : vec3<f32>, zDistance : f32) -> vec3<f32> {
      const normal : vec3<f32> = vec3<f32>(0.0, 0.0, 1.0);
      const ab : vec3<f32> =  b - a;
      const t : f32 = (zDistance - dot(normal, a)) / dot(normal, ab);
      return a + t * ab;
  }

  fn clipToView(clip : vec4<f32>) -> vec4<f32> {
      const view : vec4<f32> = frame.inverseProjectionMatrix * clip;
      return view / vec4<f32>(view.w, view.w, view.w, view.w);
  }

  fn screen2View(screen : vec4<f32>) -> vec4<f32> {
      const texCoord : vec2<f32> = screen.xy / frame.outputSize.xy;
      const clip : vec4<f32> = vec4<f32>(vec2<f32>(texCoord.x, 1.0 - texCoord.y) * 2.0 - vec2<f32>(1.0, 1.0), screen.z, screen.w);
      return clipToView(clip);
  }

  const tileCount : vec3<i32> = vec3<i32>(${TILE_COUNT[0]}, ${TILE_COUNT[1]}, ${TILE_COUNT[2]});
  const eyePos : vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  [[stage(compute)]]
  fn main() -> void {
    const tileIndex : i32 = global_id.x +
                            global_id.y * tileCount.x +
                            global_id.z * tileCount.x * tileCount.y;

    const tileSize : vec2<f32> = vec2<f32>(frame.outputSize.x / f32(tileCount.x),
                                           frame.outputSize.y / f32(tileCount.y));

    var maxPoint_sS : vec4<f32> = vec4<f32>(vec2<f32>(f32(global_id.x+1), f32(global_id.y+1)) * tileSize, -1.0, 1.0);
    var minPoint_sS : vec4<f32> = vec4<f32>(vec2<f32>(f32(global_id.x), f32(global_id.y)) * tileSize, -1.0, 1.0);


    var maxPoint_vS : vec3<f32> = screen2View(maxPoint_sS).xyz;
    var minPoint_vS : vec3<f32> = screen2View(minPoint_sS).xyz;

    const tileNear : f32 = -frame.zNear * pow(frame.zFar/ frame.zNear, f32(global_id.z)/f32(tileCount.z));
    const tileFar : f32 = -frame.zNear * pow(frame.zFar/ frame.zNear, f32(global_id.z+1)/f32(tileCount.z));

    const minPointNear : vec3<f32> = lineIntersectionToZPlane(eyePos, minPoint_vS, tileNear);
    const minPointFar : vec3<f32> = lineIntersectionToZPlane(eyePos, minPoint_vS, tileFar);
    const maxPointNear : vec3<f32> = lineIntersectionToZPlane(eyePos, maxPoint_vS, tileNear);
    const maxPointFar : vec3<f32> = lineIntersectionToZPlane(eyePos, maxPoint_vS, tileFar);

    const minAABB : vec3<f32> = min(min(minPointNear, minPointFar),min(maxPointNear, maxPointFar));
    const maxAABB : vec3<f32> = max(max(minPointNear, minPointFar),max(maxPointNear, maxPointFar));

    const midPoint : vec3<f32> = (maxAABB - minAABB) / vec3<f32>(2.0, 2.0, 2.0);

    clusters.bounds[tileIndex].center = minAABB + midPoint;
    clusters.bounds[tileIndex].radius = length(midPoint);

    return;
  }
`;

export function ClusterLightsSource(maxLights) { return `
  ${FrameUniforms}
  ${LightUniforms(maxLights)}
  ${ClusterLightsStructs}

  ${ClusterStructs}
  [[set(1), binding(0)]] var<storage_buffer> clusters : [[access(read)]] Clusters;

  ${TileFunctions}

  [[builtin(global_invocation_id)]] var<in> global_id : vec3<u32>;

  [[stage(compute)]]
  fn main() -> void {
    const tileIndex : i32 = global_id.x +
                            global_id.y * tileCount.x +
                            global_id.z * tileCount.x * tileCount.y;

    # TODO: Look into improving threading using local invocation groups?
    var activeLightCount : i32 = 0;
    for (var i : i32 = 0; i < light.lightCount; i = i + 1) {
      var lightViewPos : vec4<f32> = frame.viewMatrix * vec4<f32>(light.lights[i].position, 1.0);
      var distFromCluster : f32 = length(lightViewPos.xyz - clusters.bounds[tileIndex].center);
      if (distFromCluster <= light.lights[i].range + clusters.bounds[tileIndex].radius) {
        # Light affects this cluster. Add it to the list.
        clusterLights.lights[tileIndex].indices[activeLightCount] = i;
        activeLightCount = activeLightCount + 1;
      }
      if (activeLightCount == ${MAX_LIGHTS_PER_CLUSTER}) {
        break;
      }
    }
    clusterLights.lights[tileIndex].count = activeLightCount;

    return;
  }
`; }

/*
layout (std430, binding = 3) buffer lightSSBO{
    PointLight pointLight[];
};

layout (std430, binding = 4) buffer lightIndexSSBO{
    uint globalLightIndexList[];
};

struct LightGrid{
    uint offset;
    uint count;
};

layout (std430, binding = 5) buffer lightGridSSBO{
    LightGrid lightGrid[];
};

layout (std430, binding = 6) buffer globalIndexCountSSBO{
    uint globalIndexCount;
};

//Shared variables
shared PointLight sharedLights[16*9*4];

uniform mat4 viewMatrix;

bool testSphereAABB(uint light, uint tile);
float sqDistPointAABB(vec3 point, uint tile);

void main(){
    globalIndexCount = 0;
    uint threadCount = gl_WorkGroupSize.x * gl_WorkGroupSize.y * gl_WorkGroupSize.z;
    uint lightCount  = pointLight.length();
    uint numBatches = (lightCount + threadCount -1) / threadCount;

    uint tileIndex = gl_LocalInvocationIndex + gl_WorkGroupSize.x * gl_WorkGroupSize.y * gl_WorkGroupSize.z * gl_WorkGroupID.z;

    uint visibleLightCount = 0;
    uint visibleLightIndices[100];

    for( uint batch = 0; batch < numBatches; ++batch){
        uint lightIndex = batch * threadCount + gl_LocalInvocationIndex;

        //Prevent overflow by clamping to last light which is always null
        lightIndex = min(lightIndex, lightCount);

        //Populating shared light array
        sharedLights[gl_LocalInvocationIndex] = pointLight[lightIndex];
        barrier();

        //Iterating within the current batch of lights
        for( uint light = 0; light < threadCount; ++light){
            if( sharedLights[light].enabled  == 1){
                if( testSphereAABB(light, tileIndex) ){
                                    [visibleLightCount] = batch * threadCount + light;
                    visibleLightCount += 1;
                }
            }
        }
    }

    //We want all thread groups to have completed the light tests before continuing
    barrier();

    uint offset = atomicAdd(globalIndexCount, visibleLightCount);

    for(uint i = 0; i < visibleLightCount; ++i){
        globalLightIndexList[offset + i] = visibleLightIndices[i];
    }

    lightGrid[tileIndex].offset = offset;
    lightGrid[tileIndex].count = visibleLightCount;
}

bool testSphereAABB(uint light, uint tile){
    float radius = sharedLights[light].range;
    vec3 center  = vec3(viewMatrix * sharedLights[light].position);
    float squaredDistance = sqDistPointAABB(center, tile);

    return squaredDistance <= (radius * radius);
}

float sqDistPointAABB(vec3 point, uint tile){
    float sqDist = 0.0;
    VolumeTileAABB currentCell = cluster[tile];
    cluster[tile].maxPoint[3] = tile;
    for(int i = 0; i < 3; ++i){
        float v = point[i];
        if(v < currentCell.minPoint[i]){
            sqDist += (currentCell.minPoint[i] - v) * (currentCell.minPoint[i] - v);
        }
        if(v > currentCell.maxPoint[i]){
            sqDist += (v - currentCell.maxPoint[i]) * (v - currentCell.maxPoint[i]);
        }
    }

    return sqDist;
}
*/