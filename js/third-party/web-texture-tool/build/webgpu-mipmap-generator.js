// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.s

export class WebGPUMipmapGenerator {
  constructor(device) {
    this.device = device;
    this.sampler = device.createSampler({minFilter: 'linear'});
    // We'll need a new pipeline for every texture format used.
    this.pipelines = {};
  }

  getMipmapPipeline(format) {
    let pipeline = this.pipelines[format];
    if (!pipeline) {
      // Shaders are shared between all pipelines, so only create once.
      if (!this.mipmapVertexShaderModule || !this.mipmapFragmentShaderModule) {
        this.mipmapVertexShaderModule = this.device.createShaderModule({
          code: `
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
          `,
        });

        this.mipmapFragmentShaderModule = this.device.createShaderModule({
          code: `
            [[binding(0), set(0)]] var<uniform_constant> imgSampler : sampler;
            [[binding(1), set(0)]] var<uniform_constant> img : texture_sampled_2d<f32>;

            [[location(0)]] var<in> vTex : vec2<f32>;
            [[location(0)]] var<out> outColor : vec4<f32>;

            [[stage(fragment)]]
            fn main() -> void {
              outColor = textureSample(img, imgSampler, vTex);
              return;
            }
          `,
        });
      }

      pipeline = this.device.createRenderPipeline({
        vertexStage: {
          module: this.mipmapVertexShaderModule,
          entryPoint: 'main',
        },
        fragmentStage: {
          module: this.mipmapFragmentShaderModule,
          entryPoint: 'main',
        },
        primitiveTopology: 'triangle-strip',
        vertexState: {
          indexFormat: 'uint32',
        },
        colorStates: [{format}],
      });
      this.pipelines[format] = pipeline;
    }
    return pipeline;
  }

  /**
   * Generates mipmaps for the given GPUTexture from the data in level 0.
   *
   * @param {module:External.GPUTexture} texture - Texture to generate mipmaps for.
   * @param {object} textureDescriptor - GPUTextureDescriptor the texture was created with.
   * @returns {module:External.GPUTexture} - The originally passed texture
   */
  generateMipmap(texture, textureDescriptor) {
    // TODO: Does this need to handle sRGB formats differently?
    const pipeline = this.getMipmapPipeline(textureDescriptor.format);

    if (textureDescriptor.dimension == '3d' || textureDescriptor.dimension == '1d') {
      throw new Error('Generating mipmaps for non-2d textures is currently unsupported!');
    }

    let mipTexture = texture;
    const arrayLayerCount = textureDescriptor.size.depth || 1; // Only valid for 2D textures.

    // If the texture was created with OUTPUT_ATTACHMENT usage we can render directly between mip levels.
    const renderToSource = textureDescriptor.usage & GPUTextureUsage.OUTPUT_ATTACHMENT;
    if (!renderToSource) {
      // Otherwise we have to use a separate texture to render into. It can be one mip level smaller than the source
      // texture, since we already have the top level.
      const mipTextureDescriptor = {
        size: {
          width: Math.ceil(textureDescriptor.size.width / 2),
          height: Math.ceil(textureDescriptor.size.height / 2),
          depth: arrayLayerCount,
        },
        format: textureDescriptor.format,
        usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.SAMPLED | GPUTextureUsage.OUTPUT_ATTACHMENT,
        mipLevelCount: textureDescriptor.mipLevelCount - 1,
      };
      mipTexture = this.device.createTexture(mipTextureDescriptor);
    }

    const commandEncoder = this.device.createCommandEncoder({});
    // TODO: Consider making this static.
    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    for (let arrayLayer = 0; arrayLayer < arrayLayerCount; ++arrayLayer) {
      let srcView = texture.createView({
        baseMipLevel: 0,
        mipLevelCount: 1,
        dimension: '2d',
        baseArrayLayer: arrayLayer,
        arrayLayerCount: 1,
      });

      let dstMipLevel = renderToSource ? 1 : 0;
      for (let i = 1; i < textureDescriptor.mipLevelCount; ++i) {
        const dstView = mipTexture.createView({
          baseMipLevel: dstMipLevel++,
          mipLevelCount: 1,
          dimension: '2d',
          baseArrayLayer: arrayLayer,
          arrayLayerCount: 1,
        });

        const passEncoder = commandEncoder.beginRenderPass({
          colorAttachments: [{
            attachment: dstView,
            loadValue: [0, 0, 0, 0],
          }],
        });

        const bindGroup = this.device.createBindGroup({
          layout: bindGroupLayout,
          entries: [{
            binding: 0,
            resource: this.sampler,
          }, {
            binding: 1,
            resource: srcView,
          }],
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(4, 1, 0, 0);
        passEncoder.endPass();

        srcView = dstView;
      }
    }

    // If we didn't render to the source texture, finish by copying the mip results from the temporary mipmap texture
    // to the source.
    if (!renderToSource) {
      const mipLevelSize = {
        width: Math.ceil(textureDescriptor.size.width / 2),
        height: Math.ceil(textureDescriptor.size.height / 2),
        depth: arrayLayerCount,
      };

      // TODO: This should use textureDescriptor.mipLevelCount isntead of textureDescriptor.mipLevelCount-1, but for
      // some reason it's telling me that I'm "touching outside the texture" if I do that.
      for (let i = 1; i < textureDescriptor.mipLevelCount-1; ++i) {
        commandEncoder.copyTextureToTexture({
          texture: mipTexture,
          mipLevel: i-1,
        }, {
          texture: texture,
          mipLevel: i,
        }, mipLevelSize);

        mipLevelSize.width = Math.ceil(mipLevelSize.width / 2);
        mipLevelSize.height = Math.ceil(mipLevelSize.height / 2);
      }
    }

    this.device.defaultQueue.submit([commandEncoder.finish()]);

    if (!renderToSource) {
      mipTexture.destroy();
    }

    return texture;
  }
}
