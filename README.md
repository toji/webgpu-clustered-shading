# WebGPU Clustered Forward Shading

Live page at [https://toji.github.io/webgpu-clustered-shading/](https://toji.github.io/webgpu-clustered-shading/).

This project implements a simple clustered forward shading renderer with WebGPU. My primary goals in developing it were to learn more about the technique and some of the related tech (like compute shaders), to implement something non-trivial with WebGPU/WGSL in order to identify bugs, and to demonstrate a interesting use case for WebGPU that wasn't practical with WebGL.

While the technique IS aimed at increasing performance, optimization was not my primary concern and thus this code could probably quite easily be improved on for real-world use cases. That said, it does rather nicely demonstrate the considerable performance benefits of clustered shading vs. a more naive lighting approach.

To test the WebGPU renderer use Chrome Canary on Windows or MacOS, navigate to about:flags, and turn on the "Unsafe WebGPU" flag.

A WebGL 2.0 renderer is included for comparison/debugging but it only implements the naive path.

## Known Issues

 - Only the "naive" path works for WebGL 2.0. This is intentional, and I don't think I'm going to try fixing it any time soon.
 - There is currently a per-cluster light limit, which you can very easily see if you turn up the number of lights and give them a big radius. This is primarily because I don't think WGSL has atomic methods yet so I can't effectively do the light list compacting the way I want (or at least I don't know the workaround).
 - On Mac I've seen some blending artifacts with the lights. Unclear if this is my fault or a WebGPU implementation bug.
 - The latest Chrome Canary builds on Windows have an artifact at the edges of transparent surfaces. This is a Chrome bug, and not something I can/should fix in this code.

