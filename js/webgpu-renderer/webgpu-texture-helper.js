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

export class GPUTextureHelper {
  constructor(device, glslang) {
    this.device = device;

    const mipmapVertexSource = `
      var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0));
      var<private> tex : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0));

      [[builtin(position)]] var<out> outPosition : vec4<f32>;
      [[builtin(vertex_idx)]] var<in> vertexIndex : i32;

      [[location(0)]] var<out> vTex : vec2<f32>;

      [[stage(vertex)]]
      fn main() -> void {
        vTex = tex[vertexIndex];
        outPosition = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
        return;
      }
  `;

    const mipmapFragmentSource = `
      [[binding(0), set(0)]] var<uniform_constant> imgSampler : sampler;
      [[binding(1), set(0)]] var<uniform_constant> img : texture_sampled_2d<f32>;

      [[location(0)]] var<in> vTex : vec2<f32>;
      [[location(0)]] var<out> outColor : vec4<f32>;

      [[stage(fragment)]]
      fn main() -> void {
        outColor = textureSample(img, imgSampler, vTex);
        return;
      }
    `;

    this.mipmapSampler = device.createSampler({ minFilter: 'linear' });

    this.mipmapPipeline = device.createRenderPipeline({
      vertexStage: {
        module: device.createShaderModule({
          code: mipmapVertexSource
        }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: device.createShaderModule({
          code: mipmapFragmentSource
        }),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint32'
      },
      colorStates: [{
        format: 'rgba8unorm',
      }]
    });
  }

  // TODO: Everything about this is awful.
  generateMipmappedTexture(imageBitmap) {
    let textureSize = {
      width: imageBitmap.width,
      height: imageBitmap.height,
      depth: 1,
    }
    const mipLevelCount = Math.floor(Math.log2(Math.max(imageBitmap.width, imageBitmap.height))) + 1;

    // Populate the top level of the srcTexture with the imageBitmap.
    const srcTexture = this.device.createTexture({
      size: textureSize,
      format: 'rgba8unorm',
      // TO COMPLAIN ABOUT: Kind of worrying that this style of mipmap generation implies that almost every texture
      // generated will be an output attachment. There's gotta be a performance penalty for that.
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED | GPUTextureUsage.OUTPUT_ATTACHMENT,
      mipLevelCount
    });
    this.device.defaultQueue.copyImageBitmapToTexture({ imageBitmap }, { texture: srcTexture }, textureSize);

    const commandEncoder = this.device.createCommandEncoder({});

    const bindGroupLayout = this.mipmapPipeline.getBindGroupLayout(0);

    for (let i = 1; i < mipLevelCount; ++i) {
      const bindGroup = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{
          binding: 0,
          resource: this.mipmapSampler,
        }, {
          binding: 1,
          resource: srcTexture.createView({
            baseMipLevel: i-1,
            mipLevelCount: 1
          }),
        }],
      });

      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
          attachment: srcTexture.createView({
            baseMipLevel: i,
            mipLevelCount: 1
          }),
          loadValue: 'load',
        }],
      });
      passEncoder.setPipeline(this.mipmapPipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(4, 1, 0, 0);
      passEncoder.endPass();

      textureSize.width = Math.ceil(textureSize.width / 2);
      textureSize.height = Math.ceil(textureSize.height / 2);
    }
    this.device.defaultQueue.submit([commandEncoder.finish()]);

    return srcTexture;
  }

  generateTexture(imageBitmap) {
    const textureSize = {
      width: imageBitmap.width,
      height: imageBitmap.height,
      depth: 1,
    };

    const texture = this.device.createTexture({
      size: textureSize,
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED,
    });
    this.device.defaultQueue.copyImageBitmapToTexture({ imageBitmap }, { texture }, textureSize);

    return texture;
  }

  generateColorTexture(r, g, b, a) {
    const imageData = new Uint8Array([r * 255, g * 255, b * 255, a * 255]);

    const imageSize = { width: 1, height: 1, depth: 1 };
    const texture = this.device.createTexture({
      size: imageSize,
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED,
    });

    const textureDataBuffer = this.device.createBuffer({
      // BUG? WTF is up with this?!? bytesPerRow has to be a multiple of 256?
      size: 256,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    const textureDataArray = new Uint8Array(textureDataBuffer.getMappedRange());
    textureDataArray.set(imageData);
    textureDataBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToTexture({
      buffer: textureDataBuffer,
      bytesPerRow: 256,
      rowsPerImage: 0, // What is this for?
    }, { texture: texture }, imageSize);
    this.device.defaultQueue.submit([commandEncoder.finish()]);

    return texture;
  }
}