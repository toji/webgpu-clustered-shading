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

import { FrameUniforms } from './common.js';

// Trying something possibly very silly here: I'm going to store the cluster bounds as spheres
// (center + radius) instead of AABBs to reduce storage/intersection complexity. This will result
// in more overlap between clusters to ensure we don't have any gaps, and that may not be a good
// tradeoff, but I'll give it a try and see where the bottlenecks are.
export function ClusteredAABBSource(x, y, z) { return `
  ${FrameUniforms}

  [[builtin(global_invocation_id)]] var<in> local_id : vec3<u32>;

  [[block]] struct ClusterBounds {
    [[offset(0)]] center : vec3<f32>;
    [[offset(12)]] radius : f32;
  };
  [[block]] struct Clusters {
    [[offset(0)]] bounds : [[stride(16)]] array<ClusterBounds, ${x * y * z}>;
  };
  [[set(1), binding(0)]] var<storage_buffer> clusters : Clusters;

  # THIS CRASHES:
  # [[set(1), binding(0)]] var<storage_buffer> clusters : [[stride(32)]] array<Cluster, ${x * y * z}>;

  fn lineIntersectionToZPlane(a : vec3<f32>, b : vec3<f32>, zDistance : f32) -> vec3<f32> {
      const normal : vec3<f32> = vec3<f32>(0.0, 0.0, 1.0);
      const ab : vec3<f32> =  b - a;
      const t : f32 = (zDistance - dot(normal, a)) / dot(normal, ab);
      return a + (t * ab);
  }

  fn clipToView(clip : vec4<f32>) -> vec4<f32> {
      const view : vec4<f32> = frame.inverseProjectionMatrix * clip;
      return view / vec4<f32>(view.w, view.w, view.w, view.w);
  }

  fn screen2View(screen : vec4<f32>) -> vec4<f32> {
      const texCoord : vec2<f32> = screen.xy / frame.outputSize.xy;
      const clip : vec4<f32> = vec4<f32>(texCoord * 2.0 - vec2<f32>(1.0, 1.0), screen.z, screen.w);
      return clipToView(clip);
  }

  const tileCount : vec3<i32> = vec3<i32>(${x}, ${y}, ${z});
  const eyePos : vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  [[stage(compute)]]
  fn main() -> void {
    const tileIndex : i32 = local_id.x +
                            local_id.y * tileCount.x +
                            local_id.z * tileCount.x * tileCount.y;

    const tileSize : vec2<f32> = vec2<f32>(frame.outputSize.x / f32(tileCount.x),
                                           frame.outputSize.y / f32(tileCount.y));

    var minPoint_sS : vec4<f32> = vec4<f32>(vec2<f32>(local_id.xy) * tileSize,
                                            -1.0, 1.0);
    var maxPoint_sS : vec4<f32> = vec4<f32>(
                                      vec2<f32>(local_id.x + 1,
                                                local_id.y + 1) * tileSize,
                                      -1.0, 1.0);

    var maxPoint_vS : vec3<f32> = screen2View(maxPoint_sS).xyz;
    var minPoint_vS : vec3<f32> = screen2View(minPoint_sS).xyz;

    const tileNear : f32 = -frame.zNear * pow(frame.zFar/ frame.zNear, f32(local_id.z)/f32(tileCount.z));
    const tileFar : f32 = -frame.zNear * pow(frame.zFar/ frame.zNear, f32(local_id.z+1)/f32(tileCount.z));

    const minPointNear : vec3<f32> = lineIntersectionToZPlane(eyePos, minPoint_vS, tileNear);
    const minPointFar : vec3<f32> = lineIntersectionToZPlane(eyePos, minPoint_vS, tileFar);
    const maxPointNear : vec3<f32> = lineIntersectionToZPlane(eyePos, maxPoint_vS, tileNear);
    const maxPointFar : vec3<f32> = lineIntersectionToZPlane(eyePos, maxPoint_vS, tileFar);

    const minPointAABB : vec3<f32> = min(min(minPointNear, minPointFar),min(maxPointNear, maxPointFar));
    const maxPointAABB : vec3<f32> = max(max(minPointNear, minPointFar),max(maxPointNear, maxPointFar));

    const midPoint : vec3<f32> = (maxPointAABB - minPointAABB) / vec3<f32>(2.0, 2.0, 2.0);

    clusters.bounds[tileIndex].center = minPointAABB + midPoint;
    clusters.bounds[tileIndex].radius = length(midPoint);

    return;
  }
`; }
