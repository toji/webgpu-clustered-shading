# WebGPU Clustered Forward Shading

Live page at [https://toji.github.io/webgpu-clustered-shading/](https://toji.github.io/webgpu-clustered-shading/).

This project implements a simple clustered forward shading renderer with WebGPU. My primary goals in developing it were to learn more about the technique and some of the related tech (like compute shaders), to implement something non-trivial with WebGPU/WGSL in order to identify bugs, and to demonstrate a interesting use case for WebGPU that wasn't practical with WebGL.

While the technique IS aimed at increasing performance, optimization was not my primary concern and thus this code could probably quite easily be improved on for real-world use cases. That said, it does rather nicely demonstrate the considerable performance benefits of clustered shading vs. a more naive lighting approach.

To test the WebGPU renderer use Chrome Canary on Windows or MacOS, navigate to about:flags, and turn on the "Unsafe WebGPU" flag.

A WebGL 2.0 renderer is included for comparison/debugging but it only implements the naive path.

## Known Issues

 - Only the "naive" path works for WebGL 2.0. This is intentional, and I don't think I'm going to try fixing it any time soon.
