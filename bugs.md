# Bugs

## Something weird with passing ints into a function:

```ts
fn testSphereAABB(lightIndex : i32, tileIndex : i32) -> bool {
  const radius : f32 = light.lights[lightIndex].range;
  const lightViewPos : vec4<f32> = frame.viewMatrix * vec4<f32>(light.lights[lightIndex].position, 1.0);
  const sqDist : f32 = sqDistPointAABB(lightViewPos.xyz, tileIndex);

  return sqDist <= (radius * radius);
}

const tileIndex : i32 = global_id.x +
                        global_id.y * tileCount.x +
                        global_id.z * tileCount.x * tileCount.y;

for (var i : i32 = 0; i < light.lightCount; i = i + 1) {
  const lightInCluster : bool = testSphereAABB(i, tileIndex);
```

error: line 417: OpFunctionCall Argument <id> '256[%256]'s type does not match Function <id> '21[%int]'s parameter type.
  %271 = OpFunctionCall %bool %testSphereAABB %272 %256

## Should I be able to set bindings to an array directly?

= FILED =
```ts
//THIS CRASHES:
[[set(1), binding(0)]] var<storage_buffer> clusters : [[stride(32)]] array<Cluster, ${TOTAL_TILES}>;

//THIS DOESN'T:
[[block]] struct Clusters {
  [[offset(0)]] bounds : [[stride(32)]] array<ClusterBounds, ${TOTAL_TILES}>;
};
[[set(1), binding(0)]] var<storage_buffer> clusters : Clusters;
```

## Vector expansion weirdness

= FILED =
```ts
// This comes out white.
outColor = vec4<f32>(1.0, 0, 0, 1.0);
```

Separately:
```ts
// It's kinda hard to tell what this does, but it's not what you would expect.
var iVec : vec3<i32> = vec3<i32>(1, 2, 3);
var fVec : vec3<f32> = vec3<f32>(iVec);
```

## Can't create local struct references?

```ts
[[block]] struct ClusterBounds {
  [[offset(0)]] minAABB : vec3<f32>;
  [[offset(16)]] maxAABB : vec3<f32>;
};

// THIS CRASHES:
var clusterBounds : ClusterBounds = clusters.bounds[clusterIndex];
```

## SPIR-V failure for too few vector components

= FILED =
```ts
vec3<f32>(1.0);
```

Fails SPIR-V validation, should be caught in Tint validation.

SPIRV Validation failure:
error: line 295: OpConstantComposite Constituent <id> count does not match Result Type <id> '7[%v3float]'s vector component count.
  %506 = OpConstantComposite %v3float %float_1

## SPIR-V failure for vec + scalar

= FILED =
```ts
vec3<f32>(1.0, 1.0, 1.0) + 1.0
```

Fails SPIR-V validation, should be caught in Tint validation.

SPIRV Validation failure:
error: line 755: Expected arithmetic operands to be of Result Type: FAdd operand index 3
  %480 = OpFAdd %v3float %479 %float_1

## Alpha blending (or discard?) Broken on Mac with light sprites

= FILED =
No code for this one. just take a screenshot.

## Write buffer input offsets/size is in bytes, even when input is typed array

= FILED =
```ts
this.device.defaultQueue.writeBuffer(this.projectionUniformsBuffer, 0, this.frameUniforms, 0, ProjectionUniformsSize);
// Should be:
// this.device.defaultQueue.writeBuffer(this.projectionUniformsBuffer, 0, this.frameUniforms, 0, ProjectionUniformsSize / 4);
```

This is not what the spec says should happen

## Mix can't take a single scalar

Maybe not a "bug", but really annoying nonetheless.

= FILED =
```ts
// What I want to do:
mix(vec4<f32>(0.0, 0.0, 1.0, 1.0), vec4<f32>(1.0, 0.0, 0.0, 1.0), lightFactor);
// What I have to do:
mix(vec4<f32>(0.0, 0.0, 1.0, 1.0), vec4<f32>(1.0, 0.0, 0.0, 1.0), vec4<f32>(lightFactor, lightFactor, lightFactor, lightFactor));
```

## Cube map regression

Might be my fault. Texture tester shows:

The texture viewDimension of the bind group layout entry is different from the shader module declaration at set 0 binding 2
