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

import { Renderer } from '../renderer.js';
import { ATTRIB_MAP, UNIFORM_SET } from './shaders/common.js';
import { PBRTechnique } from './techniques/pbr-technique.js';
import { DepthSliceTechnique } from './techniques/depth-slice-technique.js';
import { DepthTechnique } from './techniques/depth-technique.js';
import { LightGroup } from './light-group.js';
import { vec2, vec3, vec4 } from '../third-party/gl-matrix/src/gl-matrix.js';
import { WebGPUTextureTool } from '../third-party/web-texture-tool/build/webgpu-texture-tool.js';


const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";

// Only used for comparing values from glTF, which uses WebGL enums natively.
const GL = WebGLRenderingContext;

export class WebGPURenderer extends Renderer {
  constructor() {
    super();

    this.context = this.canvas.getContext('gpupresent');

    this.programs = new Map();

    this.pipelines = new Map(); // Map<String -> GPURenderPipeline>
    this.pipelineMaterials = new WeakMap(); // WeakMap<GPURenderPipeline, Map<Material, Primitive[]>>

    this.opaquePipelines = [];
    this.blendedPipelines = [];

    this.primitives = null;
  }

  async init() {
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });
    this.device = await this.adapter.requestDevice();

    this.swapChainFormat = this.context.getSwapChainPreferredFormat(this.adapter);
    this.swapChain = this.context.configureSwapChain({
      device: this.device,
      format: this.swapChainFormat
    });

    this.renderBundleDescriptor = {
      colorFormats: [ this.swapChainFormat ],
      depthStencilFormat: DEPTH_FORMAT,
      sampleCount: SAMPLE_COUNT
    };

    this.textureTool = new WebGPUTextureTool(this.device);

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

    this.frameUniformsBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        type: 'uniform-buffer'
      }]
    });

    this.lightGroup = new LightGroup(this.device, this.lightManager,
        this.frameUniformsBindGroupLayout, this.renderBundleDescriptor);

    this.materialUniformsBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'uniform-buffer'
      },
      {
        binding: 1, // defaultSampler
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampler'
      },
      {
        binding: 2, // baseColorTexture
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampled-texture'
      },
      {
        binding: 3, // normalTexture
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampled-texture'
      },
      {
        binding: 4, // metallicRoughnessTexture
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampled-texture'
      },
      {
        binding: 5, // occlusionTexture
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampled-texture'
      },
      {
        binding: 6, // emissiveTexture
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampled-texture'
      }]
    });

    this.primitiveUniformsBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        type: 'uniform-buffer'
      }]
    });

    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.frameUniformsBindGroupLayout, // set 0
        this.lightGroup.bindGroupLayout, // set 1
        this.materialUniformsBindGroupLayout, // set 2
        this.primitiveUniformsBindGroupLayout, // set 3
      ]
    });

    this.frameUniformsBuffer = this.device.createBuffer({
      size: this.frameUniforms.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.frameUniformBindGroup = this.device.createBindGroup({
      layout: this.frameUniformsBindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.frameUniformsBuffer,
        },
      }],
    });

    this.blackTextureView = this.textureTool.createTextureFromColor(0, 0, 0, 0).texture.createView();
    this.whiteTextureView = this.textureTool.createTextureFromColor(1.0, 1.0, 1.0, 1.0).texture.createView();
    this.blueTextureView = this.textureTool.createTextureFromColor(0, 0, 1.0, 0).texture.createView();
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

  async setGltf(gltf) {
    const gl = this.gl;
    const resourcePromises = [];

    for (let bufferView of gltf.bufferViews) {
      resourcePromises.push(this.initBufferView(bufferView));
    }

    for (let image of gltf.images) {
      resourcePromises.push(this.initImage(image));
    }

    for (let sampler of gltf.samplers) {
      this.initSampler(sampler);
    }

    this.initNode(gltf.scene);

    await Promise.all(resourcePromises);

    for (let material of gltf.materials) {
      this.initMaterial(material);
    }

    for (let primitive of gltf.primitives) {
      this.initPrimitive(primitive);
    }

    this.primitives = gltf.primitives;
  }

  async initBufferView(bufferView) {
    let usage = 0;
    if (bufferView.usage.has('vertex')) {
      usage |= GPUBufferUsage.VERTEX;
    }
    if (bufferView.usage.has('index')) {
      usage |= GPUBufferUsage.INDEX;
    }

    if (!usage) {
      return;
    }

    // Oh FFS. Buffer copies have to be 4 byte aligned, I guess. >_<
    const alignedLength = Math.ceil(bufferView.byteLength / 4) * 4;

    const gpuBuffer = this.device.createBuffer({
      size: alignedLength,
      usage: usage | GPUBufferUsage.COPY_DST
    });
    bufferView.renderData.gpuBuffer = gpuBuffer;

    // TODO: Pretty sure this can all be handled more efficiently.
    const copyBuffer = this.device.createBuffer({
      size: alignedLength,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    const copyBufferArray = new Uint8Array(copyBuffer.getMappedRange());

    const bufferData = await bufferView.dataView;

    const srcByteArray = new Uint8Array(bufferData.buffer, bufferData.byteOffset, bufferData.byteLength);
    copyBufferArray.set(srcByteArray);
    copyBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(copyBuffer, 0, gpuBuffer, 0, alignedLength);
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }

  async initImage(image) {
    const result = await this.textureTool.loadTextureFromImageBitmap(await image);
    image.gpuTextureView = result.texture.createView();
  }

  initSampler(sampler) {
    const samplerDescriptor = {};

    switch (sampler.minFilter) {
      case undefined:
        samplerDescriptor.minFilter = 'linear';
        samplerDescriptor.mipmapFilter = 'linear';
        break;
      case GL.LINEAR:
      case GL.LINEAR_MIPMAP_NEAREST:
        samplerDescriptor.minFilter = 'linear';
        break;
      case GL.NEAREST_MIPMAP_LINEAR:
        samplerDescriptor.mipmapFilter = 'linear';
        break;
      case GL.LINEAR_MIPMAP_LINEAR:
        samplerDescriptor.minFilter = 'linear';
        samplerDescriptor.mipmapFilter = 'linear';
        break;
    }

    if (!sampler.magFilter || sampler.magFilter == GL.LINEAR) {
      samplerDescriptor.magFilter = 'linear';
    }

    switch (sampler.wrapS) {
      case GL.REPEAT:
        samplerDescriptor.addressModeU = 'repeat';
        break;
      case GL.MIRRORED_REPEAT:
        samplerDescriptor.addressModeU = 'mirror-repeat';
        break;
    }

    switch (sampler.wrapT) {
      case GL.REPEAT:
        samplerDescriptor.addressModeV = 'repeat';
        break;
      case GL.MIRRORED_REPEAT:
        samplerDescriptor.addressModeV = 'mirror-repeat';
        break;
    }

    sampler.renderData.gpuSampler = this.device.createSampler(samplerDescriptor);
  }

  initMaterial(material) {
    // Can reuse these for every PBR material
    const materialUniforms = new Float32Array(4 + 4 + 4);
    const baseColorFactor = new Float32Array(materialUniforms.buffer, 0, 4);
    const metallicRoughnessFactor = new Float32Array(materialUniforms.buffer, 4 * 4, 2);
    const emissiveFactor = new Float32Array(materialUniforms.buffer, 8 * 4, 3);

    vec4.copy(baseColorFactor, material.baseColorFactor);
    vec2.copy(metallicRoughnessFactor, material.metallicRoughnessFactor);
    vec3.copy(emissiveFactor, material.emissiveFactor);

    const materialUniformsBuffer = this.device.createBuffer({
      size: materialUniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.device.defaultQueue.writeBuffer(materialUniformsBuffer, 0, materialUniforms);

    const materialBindGroup = this.device.createBindGroup({
      layout: this.materialUniformsBindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: materialUniformsBuffer,
        },
      },
      {
        binding: 1,
        // TODO: Do we really need to pass one sampler per texture for accuracy? :(
        resource: material.baseColorTexture.sampler.renderData.gpuSampler,
      },
      {
        binding: 2,
        resource: material.baseColorTexture ? material.baseColorTexture.image.gpuTextureView : this.whiteTextureView,
      },
      {
        binding: 3,
        resource: material.normalTexture ? material.normalTexture.image.gpuTextureView : this.blueTextureView,
      },
      {
        binding: 4,
        resource: material.metallicRoughnessTexture ? material.metallicRoughnessTexture.image.gpuTextureView : this.whiteTextureView,
      },
      {
        binding: 5,
        resource: material.occlusionTexture ? material.occlusionTexture.image.gpuTextureView : this.whiteTextureView,
      },
      {
        binding: 6,
        resource: material.emissiveTexture ? material.emissiveTexture.image.gpuTextureView : this.blackTextureView,
      }],
    });

    material.renderData.gpuBindGroup = materialBindGroup;
  }

  initPrimitive(primitive) {
    const material = primitive.material;

    const vertexBuffers = [];
    for (let [bufferView, attributes] of primitive.attributeBuffers) {
      let arrayStride = bufferView.byteStride;

      const attributeLayouts = [];
      for (let attribName in attributes) {
        const attribute = attributes[attribName];

        const count = attribute.componentCount > 1 ? `${attribute.componentCount}` : '';
        const norm = attribute.normalized ? 'norm' : '';

        let format;
        switch(attribute.componentType) {
          case GL.BYTE:
            format = `char${count}${norm}`;
            break;
          case GL.UNSIGNED_BYTE:
            format = `uchar${count}${norm}`;
            break;
          case GL.SHORT:
            format = `short${count}${norm}`;
            break;
          case GL.UNSIGNED_SHORT:
            format = `ushort${count}${norm}`;
            break;
          case GL.UNSIGNED_INT:
            format = `uint${count}`;
            break;
          case GL.FLOAT:
            format = `float${count}`;
            break;
        }

        attributeLayouts.push({
          shaderLocation: ATTRIB_MAP[attribName],
          offset: attribute.byteOffset,
          format
        });

        if (!bufferView.byteStride) {
          arrayStride += attribute.packedByteStride;
        }
      }

      vertexBuffers.push({
        arrayStride,
        attributes: attributeLayouts,
      });
    }

    primitive.renderData.vertexBuffers = vertexBuffers;

    if (primitive.indices) {
      primitive.indices.gpuType = primitive.indices.type == GL.UNSIGNED_SHORT ? 'uint16' : 'uint32';
    }

    const bufferSize = 16 * 4;

    // TODO: Support multiple instances
    if (primitive.renderData.instances.length) {
      const primitiveUniformsBuffer = this.device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.device.defaultQueue.writeBuffer(primitiveUniformsBuffer, 0, primitive.renderData.instances[0]);

      const primitiveBindGroup = this.device.createBindGroup({
        layout: this.primitiveUniformsBindGroupLayout,
        entries: [{
          binding: 0,
          resource: {
            buffer: primitiveUniformsBuffer,
          },
        }],
      });

      primitive.renderData.gpuBindGroup = primitiveBindGroup;
    }
  }

  initNode(node) {
    for (let primitive of node.primitives) {
      if (!primitive.renderData.instances) {
        primitive.renderData.instances = [];
      }
      primitive.renderData.instances.push(node.worldMatrix);
    }

    for (let childNode of node.children) {
      this.initNode(childNode);
    }
  }

  renderNaiveForward(encoder) {
    if (!this.pbrTechnique) {
      this.pbrTechnique = new PBRTechnique(this.device, this.renderBundleDescriptor,
        this.pipelineLayout, this.lightManager.maxLightCount);
    }

    if (!this.pbrRenderBundle && this.primitives) {
      this.pbrRenderBundle = this.pbrTechnique.createRenderBundle(this.primitives, this.frameUniformBindGroup, this.lightGroup.uniformBindGroup);
    }

    if (this.pbrRenderBundle) {
      encoder.executeBundles([this.pbrRenderBundle]);
    }

    if (this.lightManager.render) {
      // Last, render a sprite for all of the lights.
      encoder.setBindGroup(UNIFORM_SET.Frame, this.frameUniformBindGroup);
      encoder.setBindGroup(UNIFORM_SET.Light, this.lightGroup.uniformBindGroup);
      this.lightGroup.renderSprites(encoder);
    }
  }

  renderDepth(encoder) {
    if (!this.depthTechnique) {
      this.depthTechnique = new DepthTechnique(this.device, this.renderBundleDescriptor, this.pipelineLayout);
    }

    if (!this.depthRenderBundle && this.primitives) {
      this.depthRenderBundle = this.depthTechnique.createRenderBundle(this.primitives, this.frameUniformBindGroup, this.lightGroup.uniformBindGroup);
    }

    if (this.depthRenderBundle) {
      encoder.executeBundles([this.depthRenderBundle]);
    }

    if (this.lightManager.render) {
      // Last, render a sprite for all of the lights.
      encoder.setBindGroup(UNIFORM_SET.Frame, this.frameUniformBindGroup);
      encoder.setBindGroup(UNIFORM_SET.Light, this.lightGroup.uniformBindGroup);
      this.lightGroup.renderSprites(encoder);
    }
  }

  renderDepthSlices(encoder) {
    if (!this.depthSliceTechnique) {
      this.depthSliceTechnique = new DepthSliceTechnique(this.device, this.renderBundleDescriptor, this.pipelineLayout);
    }

    if (!this.depthSliceRenderBundle && this.primitives) {
      this.depthSliceRenderBundle = this.depthSliceTechnique.createRenderBundle(this.primitives, this.frameUniformBindGroup, this.lightGroup.uniformBindGroup);
    }

    if (this.depthSliceRenderBundle) {
      encoder.executeBundles([this.depthSliceRenderBundle]);
    }

    if (this.lightManager.render) {
      // Last, render a sprite for all of the lights.
      encoder.setBindGroup(UNIFORM_SET.Frame, this.frameUniformBindGroup);
      encoder.setBindGroup(UNIFORM_SET.Light, this.lightGroup.uniformBindGroup);
      this.lightGroup.renderSprites(encoder);
    }
  }

  onFrame(timestamp) {
    // TODO: If we want multisampling this should attach to the resolveTarget,
    // but there seems to be a bug with that right now?
    this.colorAttachment.resolveTarget = this.swapChain.getCurrentTexture().createView();

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    this.device.defaultQueue.writeBuffer(this.frameUniformsBuffer, 0, this.frameUniforms);

    // Update the light unforms as well
    this.lightGroup.updateUniforms();

    const commandEncoder = this.device.createCommandEncoder({});

    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    switch (this.outputType) {
      case "naive-forward":
        this.renderNaiveForward(passEncoder);
        break;
      case "depth":
        this.renderDepth(passEncoder);
        break;
      case "depth-slice":
        this.renderDepthSlices(passEncoder);
        break;
    }

    passEncoder.endPass();
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }

  drawPipelinePrimitives(passEncoder, pipeline) {
    passEncoder.setPipeline(pipeline);
    const materialPrimitives = this.pipelineMaterials.get(pipeline);
    for (let [material, primitives] of materialPrimitives) {
      passEncoder.setBindGroup(UNIFORM_SET.Material, material.renderData.gpuBindGroup);

      for (let primitive of primitives) {
        passEncoder.setBindGroup(UNIFORM_SET.Primitive, primitive.renderData.gpuBindGroup);

        let i = 0;
        for (let bufferView of primitive.attributeBuffers.keys()) {
          passEncoder.setVertexBuffer(i, bufferView.renderData.gpuBuffer);
          i++;
        }

        if (primitive.indices) {
          passEncoder.setIndexBuffer(primitive.indices.bufferView.renderData.gpuBuffer,
                                     primitive.indices.gpuType, primitive.indices.byteOffset);
          passEncoder.drawIndexed(primitive.elementCount, 1, 0, 0, 0);
        } else {
          passEncoder.draw(primitive.elementCount, 1, 0, 0);
        }
      }
    }
  }
}