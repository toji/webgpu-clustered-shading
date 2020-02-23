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

import { GltfRenderer } from '../gltf-renderer.js';

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";

// Only used for comparing values from glTF, which uses WebGL enums natively.
const GL = WebGLRenderingContext;

export class WebGPURenderer extends GltfRenderer {
  constructor() {
    super();

    this.context = this.canvas.getContext('gpupresent');
  }

  async init() {
    this.adapter = await navigator.gpu.requestAdapter();
    this.device = await this.adapter.requestDevice();
    this.swapChainFormat = await this.context.getSwapChainPreferredFormat(this.device);
    this.swapChain = this.context.configureSwapChain({
      device: this.device,
      format: this.swapChainFormat
    });

    this.colorAttachment = {
      // attachment is acquired and set in onResize.
      attachment: undefined,
      // attachment is acquired and set in onFrame.
      resolveTarget: undefined,
      loadValue: { r: 0.0, g: 0.0, b: 0.5, a: 1.0 },
    };

    this.depthAttachment = {
      // attachment is acquired and set in onResize.
      attachment: undefined,
      depthLoadValue: 1.0,
      depthStoreOp: 'store',
      stencilLoadValue: 0,
      stencilStoreOp: 'store',
    };

    this.renderPassDescriptor = {
      colorAttachments: [this.colorAttachment],
      depthStencilAttachment: this.depthAttachment
    };
  }

  onResize(width, height) {
    if (!this.device) return;

    const msaaColorTexture = this.device.createTexture({
      size: { width, height, depth: 1 },
      sampleCount: SAMPLE_COUNT,
      format: this.swapChainFormat,
      usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
    });
    this.colorAttachment.attachment = msaaColorTexture.createView();

    const depthTexture = this.device.createTexture({
      size: { width, height, depth: 1 },
      sampleCount: SAMPLE_COUNT,
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.OUTPUT_ATTACHMENT
    });
    this.depthAttachment.attachment = depthTexture.createView();
  }

  setGltf(gltf) {
    const gl = this.gl;
    const resourcePromises = [];

    for (let bufferView of gltf.bufferViews) {
      resourcePromises.push(this.initBufferView(bufferView));
    }

    /*for (let image of gltf.images) {
      resourcePromises.push(this.initImage(image));
    }*/

    for (let sampler of gltf.samplers) {
      this.initSampler(sampler);
    }

    for (let primitive of gltf.primitives) {
      this.initPrimitive(primitive);
    }

    this.initNode(gltf.scene);

    return Promise.all(resourcePromises);
  }

  async initBufferView(bufferView) {
    let usage = 0;
    if (bufferView.usage.indexOf('vertex') != -1) {
      usage |= GPUBufferUsage.VERTEX;
    }
    if (bufferView.usage.indexOf('index') != -1) {
      usage |= GPUBufferUsage.INDEX;
    }

    if (!usage) {
      return;
    }

    const gpuBuffer = this.device.createBuffer({
      size: bufferView.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST
    });
    bufferView.renderData.gpuBuffer = gpuBuffer;

    const bufferData = await bufferView.dataView;
    gpuBuffer.setSubData(0, bufferData);
  }

  initSampler(sampler) {
    const samplerDescriptor = {};

    switch (sampler.minFilter) {
      case GL.LINEAR:
      case GL.LINEAR_MIPMAP_NEAREST:
        samplerDescriptor.minFilter = "linear";
        break;
      case GL.NEAREST_MIPMAP_LINEAR:
        samplerDescriptor.mipmapFilter = "linear";
        break;
      case GL.LINEAR_MIPMAP_LINEAR:
        samplerDescriptor.minFilter = "linear";
        samplerDescriptor.mipmapFilter = "linear";
        break;
    }

    if (sampler.magFilter == GL.LINEAR) {
      samplerDescriptor.magFilter = "linear";
    }

    switch (sampler.wrapS) {
      case GL.REPEAT:
        samplerDescriptor.addressModeU = "repeat";
        break;
      case GL.MIRRORED_REPEAT:
        samplerDescriptor.addressModeU = "mirror-repeat";
        break;
    }

    switch (sampler.wrapT) {
      case GL.REPEAT:
        samplerDescriptor.addressModeV = "repeat";
        break;
      case GL.MIRRORED_REPEAT:
        samplerDescriptor.addressModeV = "mirror-repeat";
        break;
    }

    sampler.renderData.gpuSampler = this.device.createSampler(samplerDescriptor);
  }

  initPrimitive(primitive) {
    const material = primitive.material;

    primitive.renderData.instances = [];

    /*let key = '';
    for (let define in defines) {
      key += `${define}=${defines[define]},`;
    }*/

    /*let program = this.programs.get(key);
    if (!program) {
      program = new PBRShaderProgram(this.gl, defines);
      this.programs.set(key, program);
    }

    const glVertexArray = gl.createVertexArray();
    gl.bindVertexArray(glVertexArray);
    program.bindPrimitive(primitive); // Populates the vertex buffer bindings for the VertexArray
    primitive.renderData.glVertexArray = glVertexArray;

    let primitiveList;
    if (material.blend) {
      primitiveList = program.blendedMaterials.get(material);
      if (!primitiveList) {
        primitiveList = [];
        program.blendedMaterials.set(material, primitiveList);
      }
    } else {
      primitiveList = program.opaqueMaterials.get(material);
      if (!primitiveList) {
        primitiveList = [];
        program.opaqueMaterials.set(material, primitiveList);
      }
    }
    primitiveList.push(primitive);*/
  }

  initNode(node) {
    for (let primitive of node.primitives) {
      primitive.renderData.instances.push(node.worldMatrix);
    }

    for (let childNode of node.children) {
      this.initNode(childNode);
    }
  }

  onFrame(timestamp) {
    const commandEncoder = this.device.createCommandEncoder({});

    this.colorAttachment.resolveTarget = this.swapChain.getCurrentTexture().createView();
    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    passEncoder.endPass();
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }
}