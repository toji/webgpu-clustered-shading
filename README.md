# Web Graphics API Test

Live page at [https://toji.github.io/webgpu-test/](https://toji.github.io/webgpu-test/).

This project renders a scene using WebGL, WebGL 2.0, and WebGPU as implemented in Chrome Canary circa Feb 2020. The purpose was mostly educational for me, I wanted to learn about the current state of WebGPU, but I also wanted to create a page that would allow for simple comparisons and profiling between the APIs.

The renderer for each API loads resources from a glTF file and renders them using best practices for each API (without extensions). The scene was selected to be interesting and reasonably real-world in terms of geometry and materials, but it isn't particularly challenging for many modern GPUs, so don't expect to see framerate differences between the renderers. Additionally since the scene is the same and shaders are roughly equivalent across renderers the GPU time spent will probably be about the same.

The more interesting thing to look at is how much time each API spends submitting commands on the JavaScript main thread, which is what the stats counter in the upper left corner is configured to show by default. Even then, though, it's worth noting that this is a relatively simple usage of each API rendering a largely static scene without much of the overhead that would come from more realistic app logic, animation, audio, etc. Also WebGPU is still a work in progress and is expected to undergo both API changes and implementation optimizations prior to shipping. As such any performance observations made with this project should be taken with a grain of salt.

## WebGL
The most verbose API, so it's easily the slowest. In real world apps you'd definitely want to use at least the OES_vertex_array_object and ANGLE_instanced_arrays if applicable to reduce the number of API calls needed. Here it mostly serves as a baseline to compare the performance of the other renderers to.

## WebGL 2.0
The biggest gains with this renderer vs. the WebGL renderer come from using Vertex Array Objects and Uniform Buffer Objects to drastically reduce the number of calls in the render loop. Instancing is also used to reduce the number of calls needed to render the light orbs. (The main scene does not use instancing because the source asset was not configured to use it.)

## WebGPU
The nature of the API means that most of the work is done at initialization time, so the number of calls needed to dispatch draw commands is lower than WebGL 2.0 to begin with, but the render loop is reduced down to almost nothing by using the GPURenderBundles to record the draw commands used at load time and replay them with a single call during the frame callback.

It should be noted that the WebGPU code path uses [WGSL shaders](https://gpuweb.github.io/gpuweb/wgsl.html), which is WebGPU's native shading language but is not yet finalized. Some breakage is expected in the future, but I'll generally keep it up-to-date with Chrome Canary's implementation.

To test the WebGPU renderer use Chrome Canary on Windows or MacOS, navigate to about:flags, and turn on the "Unsafe WebGPU" flag.
