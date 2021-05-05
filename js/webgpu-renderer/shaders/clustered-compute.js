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

// Lots of this is ported or otherwise influenced by http://www.aortiz.me/2018/12/21/CG.html and
// https://github.com/Angelo1211/HybridRenderingEngine

import { ProjectionUniforms, ViewUniforms, LightUniforms, BIND_GROUP } from './common.js';

export const TILE_COUNT = [32, 18, 48];
export const TOTAL_TILES = TILE_COUNT[0] * TILE_COUNT[1] * TILE_COUNT[2];

// Each cluster tracks up to MAX_LIGHTS_PER_CLUSTER light indices (ints) and one light count.
// This limitation should be able to go away when we have atomic methods in WGSL.
export const MAX_LIGHTS_PER_CLUSTER = 100;
export const CLUSTER_LIGHTS_SIZE = (4 * MAX_LIGHTS_PER_CLUSTER) + 4;

export const TileFunctions = `
let tileCount : vec3<u32> = vec3<u32>(${TILE_COUNT[0]}u, ${TILE_COUNT[1]}u, ${TILE_COUNT[2]}u);

fn linearDepth(depthSample : f32) -> f32 {
  let depthRange : f32 = 2.0 * depthSample - 1.0;
  return 2.0 * projection.zNear * projection.zFar / (projection.zFar + projection.zNear - depthRange * (projection.zFar - projection.zNear));
}

fn getTile(fragCoord : vec4<f32>) -> vec3<u32> {
  // TODO: scale and bias calculation can be moved outside the shader to save cycles.
  let sliceScale : f32 = f32(tileCount.z) / log2(projection.zFar / projection.zNear);
  let sliceBias : f32 = -(f32(tileCount.z) * log2(projection.zNear) / log2(projection.zFar / projection.zNear));
  let zTile : u32 = u32(max(log2(linearDepth(fragCoord.z)) * sliceScale + sliceBias, 0.0));

  return vec3<u32>(u32(fragCoord.x / (projection.outputSize.x / f32(tileCount.x))),
                   u32(fragCoord.y / (projection.outputSize.y / f32(tileCount.y))),
                   zTile);
}

fn getClusterIndex(fragCoord : vec4<f32>) -> u32 {
  let tile : vec3<u32> = getTile(fragCoord);
  return tile.x +
         tile.y * tileCount.x +
         tile.z * tileCount.x * tileCount.y;
}
`;

export const ClusterStructs = `
  struct ClusterBounds {
    minAABB : vec3<f32>;
    maxAABB : vec3<f32>;
  };
  [[block]] struct Clusters {
    bounds : [[stride(32)]] array<ClusterBounds, ${TOTAL_TILES}>;
  };
`;

export const ClusterLightsStructs = `
  struct ClusterLights {
    count : u32;
    indices : [[stride(4)]] array<u32, ${MAX_LIGHTS_PER_CLUSTER}>;
  };
  [[block]] struct ClusterLightGroup {
    lights : [[stride(${CLUSTER_LIGHTS_SIZE})]] array<ClusterLights, ${TOTAL_TILES}>;
  };
  [[group(${BIND_GROUP.Frame}), binding(3)]] var<storage> clusterLights : [[access(read_write)]] ClusterLightGroup;
`;

export const ClusterBoundsSource = `
  ${ProjectionUniforms}
  ${ClusterStructs}
  [[group(1), binding(0)]] var<storage> clusters : [[access(write)]] Clusters;

  fn lineIntersectionToZPlane(a : vec3<f32>, b : vec3<f32>, zDistance : f32) -> vec3<f32> {
    let normal : vec3<f32> = vec3<f32>(0.0, 0.0, 1.0);
    let ab : vec3<f32> =  b - a;
    let t : f32 = (zDistance - dot(normal, a)) / dot(normal, ab);
    return a + t * ab;
  }

  fn clipToView(clip : vec4<f32>) -> vec4<f32> {
    let view : vec4<f32> = projection.inverseMatrix * clip;
    return view / vec4<f32>(view.w, view.w, view.w, view.w);
  }

  fn screen2View(screen : vec4<f32>) -> vec4<f32> {
    let texCoord : vec2<f32> = screen.xy / projection.outputSize.xy;
    let clip : vec4<f32> = vec4<f32>(vec2<f32>(texCoord.x, 1.0 - texCoord.y) * 2.0 - vec2<f32>(1.0, 1.0), screen.z, screen.w);
    return clipToView(clip);
  }

  let tileCount : vec3<u32> = vec3<u32>(${TILE_COUNT[0]}u, ${TILE_COUNT[1]}u, ${TILE_COUNT[2]}u);
  let eyePos : vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  [[stage(compute)]]
  fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
    let tileIndex : u32 = global_id.x +
                          global_id.y * tileCount.x +
                          global_id.z * tileCount.x * tileCount.y;

    let tileSize : vec2<f32> = vec2<f32>(projection.outputSize.x / f32(tileCount.x),
                                         projection.outputSize.y / f32(tileCount.y));

    let maxPoint_sS : vec4<f32> = vec4<f32>(vec2<f32>(f32(global_id.x+1u), f32(global_id.y+1u)) * tileSize, -1.0, 1.0);
    let minPoint_sS : vec4<f32> = vec4<f32>(vec2<f32>(f32(global_id.x), f32(global_id.y)) * tileSize, -1.0, 1.0);

    let maxPoint_vS : vec3<f32> = screen2View(maxPoint_sS).xyz;
    let minPoint_vS : vec3<f32> = screen2View(minPoint_sS).xyz;

    let tileNear : f32 = -projection.zNear * pow(projection.zFar/ projection.zNear, f32(global_id.z)/f32(tileCount.z));
    let tileFar : f32 = -projection.zNear * pow(projection.zFar/ projection.zNear, f32(global_id.z+1u)/f32(tileCount.z));

    let minPointNear : vec3<f32> = lineIntersectionToZPlane(eyePos, minPoint_vS, tileNear);
    let minPointFar : vec3<f32> = lineIntersectionToZPlane(eyePos, minPoint_vS, tileFar);
    let maxPointNear : vec3<f32> = lineIntersectionToZPlane(eyePos, maxPoint_vS, tileNear);
    let maxPointFar : vec3<f32> = lineIntersectionToZPlane(eyePos, maxPoint_vS, tileFar);

    clusters.bounds[tileIndex].minAABB = min(min(minPointNear, minPointFar),min(maxPointNear, maxPointFar));
    clusters.bounds[tileIndex].maxAABB = max(max(minPointNear, minPointFar),max(maxPointNear, maxPointFar));
  }
`;

export const ClusterLightsSource = `
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${LightUniforms}
  ${ClusterLightsStructs}

  ${ClusterStructs}
  [[group(1), binding(0)]] var<storage> clusters : [[access(read)]] Clusters;

  ${TileFunctions}

  fn sqDistPointAABB(point : vec3<f32>, minAABB : vec3<f32>, maxAABB : vec3<f32>) -> f32 {
    var sqDist : f32 = 0.0;
    // const minAABB : vec3<f32> = clusters.bounds[tileIndex].minAABB;
    // const maxAABB : vec3<f32> = clusters.bounds[tileIndex].maxAABB;

    // Wait, does this actually work? Just porting code, but it seems suspect?
    for(var i : i32 = 0; i < 3; i = i + 1) {
      let v : f32 = point[i];
      if(v < minAABB[i]){
        sqDist = sqDist + (minAABB[i] - v) * (minAABB[i] - v);
      }
      if(v > maxAABB[i]){
        sqDist = sqDist + (v - maxAABB[i]) * (v - maxAABB[i]);
      }
    }

    return sqDist;
  }

  [[stage(compute)]]
  fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
    let tileIndex : u32 = global_id.x +
                          global_id.y * tileCount.x +
                          global_id.z * tileCount.x * tileCount.y;

    // TODO: Look into improving threading using local invocation groups?
    var clusterLightCount : u32 = 0u;
    var cluserLightIndices : array<u32, ${MAX_LIGHTS_PER_CLUSTER}>;
    for (var i : u32 = 0u; i < globalLights.lightCount; i = i + 1u) {
      let range : f32 = globalLights.lights[i].range;
      // Lights without an explicit range affect every cluster, but this is a poor way to handle that.
      var lightInCluster : bool = range <= 0.0;

      if (!lightInCluster) {
        let lightViewPos : vec4<f32> = view.matrix * vec4<f32>(globalLights.lights[i].position, 1.0);
        let sqDist : f32 = sqDistPointAABB(lightViewPos.xyz, clusters.bounds[tileIndex].minAABB, clusters.bounds[tileIndex].maxAABB);
        lightInCluster = sqDist <= (range * range);
      }

      if (lightInCluster) {
        // Light affects this cluster. Add it to the list.
        cluserLightIndices[clusterLightCount] = i;
        clusterLightCount = clusterLightCount + 1u;
      }

      if (clusterLightCount == ${MAX_LIGHTS_PER_CLUSTER}u) {
        break;
      }
    }

    // TODO: Stick a barrier here and track cluster lights with an offset into a global light list

    for(var i : u32 = 0u; i < clusterLightCount; i = i + 1u) {
      clusterLights.lights[tileIndex].indices[i] = cluserLightIndices[i];
    }

    clusterLights.lights[tileIndex].count = clusterLightCount;
  }
`;