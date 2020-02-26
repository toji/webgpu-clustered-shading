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

    const mipmapVertexSource = `#version 450
      const vec2 pos[4] = vec2[4](vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f), vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f));
      const vec2 tex[4] = vec2[4](vec2(0.0f, 0.0f), vec2(1.0f, 0.0f), vec2(0.0f, 1.0f), vec2(1.0f, 1.0f));
      layout(location = 0) out vec2 vTex;
      void main() {
        vTex = tex[gl_VertexIndex];
        gl_Position = vec4(pos[gl_VertexIndex], 0.0, 1.0);
      }
    `;

    const mipmapFragmentSource = `#version 450
      layout(set = 0, binding = 0) uniform sampler imgSampler;
      layout(set = 0, binding = 1) uniform texture2D img;
      layout(location = 0) in vec2 vTex;
      layout(location = 0) out vec4 outColor;
      void main() {
        outColor = texture(sampler2D(img, imgSampler), vTex);
      }
    `;

    this.mipmapSampler = device.createSampler({ minFilter: 'linear' });

    this.mipmapBindGroupLayout = device.createBindGroupLayout({
      bindings: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampler'
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampled-texture'
      }]
    });

    this.mipmapPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.mipmapBindGroupLayout] }),
      vertexStage: {
        module: device.createShaderModule({
          code: glslang.compileGLSL(mipmapVertexSource, 'vertex')
        }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: device.createShaderModule({
          code: glslang.compileGLSL(mipmapFragmentSource, 'fragment')
        }),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
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
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED | GPUTextureUsage.OUTPUT_ATTACHMENT,
      mipLevelCount
    });
    this.device.defaultQueue.copyImageBitmapToTexture({ imageBitmap }, { texture: srcTexture }, textureSize);

    // BUG: The fact that we have to create a second texture here is due to a bug in Chrome that doesn't allow you to
    // use a single texture as both a sampler and a output attachement at the same time. If we could do that this code
    // would use half as much GPU allocations and no copyTextureToTexture calls.
    const mipmappedTexture = this.device.createTexture({
      size: textureSize,
      format: 'rgba8unorm',
      // TO COMPLAIN ABOUT: Kind of worrying that this style of mipmap generation implies that almost every texture
      // generated will be an output attachment. There's gotta be a performance penalty for that.
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.SAMPLED | GPUTextureUsage.OUTPUT_ATTACHMENT,
      mipLevelCount
    });

    const commandEncoder = this.device.createCommandEncoder({});

    // BUG: Chrome currently says that if any level of a texture is incomplete the entire thing gets wiped to black when
    // you attempt to sample from it. This is despite the fact that below we're using texture views restricted
    // exclusively to the known populated mip levels. As a result in order for this code to work properly we first have
    // to clear EVERY level of the mip chain (except the first, which was populated with copyImageBitmapToTexture)
    // before we can render with it.
    for (let i = 1; i < mipLevelCount; ++i) {
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
          attachment: srcTexture.createView({
            baseMipLevel: i,
            mipLevelCount: 1
          }),
          loadValue: { r: 1.0, g: 0.0, b: 0.0, a: 0.0 },
        }],
      });
      passEncoder.endPass();
    }

    for (let i = 0; i < mipLevelCount; ++i) {
      const bindGroup = this.device.createBindGroup({
        layout: this.mipmapBindGroupLayout,
        bindings: [{
          binding: 0,
          resource: this.mipmapSampler,
        }, {
          binding: 1,
          resource: srcTexture.createView({
            baseMipLevel: Math.max(0, i-1),
            mipLevelCount: 1
          }),
        }],
      });

      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
          attachment: mipmappedTexture.createView({
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

      commandEncoder.copyTextureToTexture({
        texture: mipmappedTexture,
        mipLevel: i
      }, {
        texture: srcTexture,
        mipLevel: i
      }, textureSize);

      textureSize.width = Math.ceil(textureSize.width / 2);
      textureSize.height = Math.ceil(textureSize.height / 2);
    }
    this.device.defaultQueue.submit([commandEncoder.finish()]);

    srcTexture.destroy();

    return mipmappedTexture;
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
      // BUG? WTF is up with this?!? rowPitch has to be a multiple of 256?
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    textureDataBuffer.setSubData(0, imageData);

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToTexture({
      buffer: textureDataBuffer,
      rowPitch: 256,
      imageHeight: 0, // What is this for?
    }, { texture: texture }, imageSize);
    this.device.defaultQueue.submit([commandEncoder.finish()]);

    return texture;
  }
}