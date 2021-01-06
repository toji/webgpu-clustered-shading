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
import { ProjectionUniformsSize, ViewUniformsSize, BIND_GROUP } from './shaders/common.js';
import { PBRRenderBundleHelper, PBRClusteredRenderBundleHelper } from './pbr-render-bundle-helper.js';
import { DepthVisualization, DepthSliceVisualization, ClusterDistanceVisualization, LightsPerClusterVisualization } from './debug-visualizations.js';
import { LightSpriteVertexSource, LightSpriteFragmentSource } from './shaders/light-sprite.js';
import { vec2, vec3, vec4 } from '../third-party/gl-matrix/src/gl-matrix.js';
import { WebGPUTextureTool } from '../third-party/web-texture-tool/build/webgpu-texture-tool.js';

import { ClusterBoundsSource, ClusterLightsSource, TILE_COUNT, TOTAL_TILES, CLUSTER_LIGHTS_SIZE } from './shaders/clustered-compute.js';
import { createShaderModuleDebug } from './wgsl-utils.js';

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";

// Can reuse these for every PBR material
const materialUniforms = new Float32Array(4 + 4 + 4);
const baseColorFactor = new Float32Array(materialUniforms.buffer, 0, 4);
const metallicRoughnessFactor = new Float32Array(materialUniforms.buffer, 4 * 4, 2);
const emissiveFactor = new Float32Array(materialUniforms.buffer, 8 * 4, 3);

export class WebGPURenderer extends Renderer {
  constructor() {
    super();

    this.context = this.canvas.getContext('gpupresent');

    this.outputHelpers = {
      'naive-forward': PBRRenderBundleHelper,
      'clustered-forward': PBRClusteredRenderBundleHelper,
      'depth': DepthVisualization,
      'depth-slice': DepthSliceVisualization,
      'cluster-distance': ClusterDistanceVisualization,
      'lights-per-cluster': LightsPerClusterVisualization,
    };
  }

  async init() {
    this.outputRenderBundles = {};

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

    this.bindGroupLayouts = {
      frame: this.device.createBindGroupLayout({
        entries: [{
          binding: 0, // Projection uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          type: 'uniform-buffer'
        }, {
          binding: 1, // View uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
          type: 'uniform-buffer'
        }, {
          binding: 2, // Light uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        }, {
          binding: 3, // Cluster Lights storage
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          type: 'storage-buffer'
        }]
      }),

      material: this.device.createBindGroupLayout({
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
      }),

      primitive: this.device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          type: 'uniform-buffer'
        }]
      }),

      cluster: this.device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          type: 'readonly-storage-buffer'
        }]
      }),
    };

    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.bindGroupLayouts.frame, // set 0
        this.bindGroupLayouts.material, // set 1
        this.bindGroupLayouts.primitive, // set 2
      ]
    });

    this.projectionBuffer = this.device.createBuffer({
      size: ProjectionUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.viewBuffer = this.device.createBuffer({
      size: ViewUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.lightsBuffer = this.device.createBuffer({
      size: this.lightManager.uniformArray.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    this.clusterLightsBuffer = this.device.createBuffer({
      size: CLUSTER_LIGHTS_SIZE * TOTAL_TILES,
      usage: GPUBufferUsage.STORAGE
    });

    this.bindGroups = {
      frame: this.device.createBindGroup({
        layout: this.bindGroupLayouts.frame,
        entries: [{
          binding: 0,
          resource: {
            buffer: this.projectionBuffer,
          },
        }, {
          binding: 1,
          resource: {
            buffer: this.viewBuffer,
          },
        }, {
          binding: 2,
          resource: {
            buffer: this.lightsBuffer,
          },
        }, {
          binding: 3,
          resource: {
            buffer: this.clusterLightsBuffer
          }
        }],
      })
    }

    this.blackTextureView = this.textureTool.createTextureFromColor(0, 0, 0, 0).texture.createView();
    this.whiteTextureView = this.textureTool.createTextureFromColor(1.0, 1.0, 1.0, 1.0).texture.createView();
    this.blueTextureView = this.textureTool.createTextureFromColor(0, 0, 1.0, 0).texture.createView();

    // Setup a render pipeline for drawing the light sprites
    this.lightSpritePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.bindGroupLayouts.frame, // set 0
        ]
      }),
      vertexStage: {
        module: createShaderModuleDebug(this.device, LightSpriteVertexSource),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: createShaderModuleDebug(this.device, LightSpriteFragmentSource),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint32'
      },
      colorStates: [{
        format: this.swapChainFormat,
        colorBlend: {
          srcFactor: 'src-alpha',
          dstFactor: 'one',
        }
      }],
      depthStencilState: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: DEPTH_FORMAT,
      },
      sampleCount: SAMPLE_COUNT,
    });
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

    // On every size change we need to re-compute the cluster grid.
    this.computeClusterBounds();
  }

  async setGltf(gltf) {
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
    const result = await this.textureTool.loadTextureFromBlob(await image);
    image.gpuTextureView = result.texture.createView();
  }

  initSampler(sampler) {
    sampler.renderData.gpuSampler = this.device.createSampler(sampler.gpuSamplerDescriptor);
  }

  initMaterial(material) {
    vec4.copy(baseColorFactor, material.baseColorFactor);
    vec2.copy(metallicRoughnessFactor, material.metallicRoughnessFactor);
    vec3.copy(emissiveFactor, material.emissiveFactor);

    const materialBuffer = this.device.createBuffer({
      size: materialUniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.device.defaultQueue.writeBuffer(materialBuffer, 0, materialUniforms);

    const materialBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayouts.material,
      entries: [{
        binding: 0,
        resource: {
          buffer: materialBuffer,
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
    const bufferSize = 16 * 4;

    // TODO: Support multiple instances
    if (primitive.renderData.instances.length) {
      const modelBuffer = this.device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.device.defaultQueue.writeBuffer(modelBuffer, 0, primitive.renderData.instances[0]);

      const modelBindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayouts.primitive,
        entries: [{
          binding: 0,
          resource: {
            buffer: modelBuffer,
          },
        }],
      });

      primitive.renderData.gpuBindGroup = modelBindGroup;
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

  computeClusterBounds() {
    if (!this.clusterPipeline) {
      const clusterStorageBindGroupLayout = this.device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          type: 'storage-buffer'
        }]
      });

      this.clusterPipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [
            this.bindGroupLayouts.frame, // set 0
            clusterStorageBindGroupLayout, // set 1
          ]
        }),
        computeStage: {
          module: createShaderModuleDebug(this.device, ClusterBoundsSource),
          entryPoint: 'main',
        }
      });

      this.clusterBuffer = this.device.createBuffer({
        size: TOTAL_TILES * 32, // Cluster x, y, z size * 32 bytes per cluster.
        usage: GPUBufferUsage.STORAGE
      });

      this.clusterStorageBindGroup = this.device.createBindGroup({
        layout: clusterStorageBindGroupLayout,
        entries: [{
          binding: 0,
          resource: {
            buffer: this.clusterBuffer,
          },
        }],
      });

      this.bindGroups.cluster = this.device.createBindGroup({
        layout: this.bindGroupLayouts.cluster,
        entries: [{
          binding: 0,
          resource: {
            buffer: this.clusterBuffer,
          },
        }],
      });
    }

    // Update the Projection uniforms. These only need to be updated on resize.
    this.device.defaultQueue.writeBuffer(this.projectionBuffer, 0, this.frameUniforms, 0, ProjectionUniformsSize);

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.bindGroups.frame);
    passEncoder.setBindGroup(1, this.clusterStorageBindGroup);
    passEncoder.dispatch(...TILE_COUNT);
    passEncoder.endPass();
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }

  computeClusterLights(commandEncoder) {
    // On every size change we need to re-compute the cluster grid.
    if (!this.clusterLightsPipeline) {
      const clusterLightsPipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.bindGroupLayouts.frame, // set 0
          this.bindGroupLayouts.cluster, // set 1
        ]
      });

      this.clusterLightsPipeline = this.device.createComputePipeline({
        layout: clusterLightsPipelineLayout,
        computeStage: {
          module: createShaderModuleDebug(this.device, ClusterLightsSource),
          entryPoint: 'main',
        }
      });
    }

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterLightsPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.bindGroups.frame);
    passEncoder.setBindGroup(1, this.bindGroups.cluster);
    passEncoder.dispatch(...TILE_COUNT);
    passEncoder.endPass();
  }

  onFrame(timestamp) {
    // TODO: If we want multisampling this should attach to the resolveTarget,
    // but there seems to be a bug with that right now?
    this.colorAttachment.resolveTarget = this.swapChain.getCurrentTexture().createView();

    // Update the View uniforms buffer with the values. These are used by most shader programs
    // and don't change for the duration of the frame.
    this.device.defaultQueue.writeBuffer(this.viewBuffer, 0, this.frameUniforms, ProjectionUniformsSize, ViewUniformsSize);

    // Update the light unform buffer with the latest values as well.
    this.device.defaultQueue.writeBuffer(this.lightsBuffer, 0, this.lightManager.uniformArray);

    // Create a render bundle for the requested output type if one doesn't already exist.
    let renderBundle = this.outputRenderBundles[this.outputType];
    if (!renderBundle && this.primitives) {
      const helperConstructor = this.outputHelpers[this.outputType];
      const renderBundleHelper = new helperConstructor(this);
      renderBundle = this.outputRenderBundles[this.outputType] = renderBundleHelper.createRenderBundle(this.primitives);
    }

    const commandEncoder = this.device.createCommandEncoder({});

    switch (this.outputType) {
      case "lights-per-cluster":
      case "clustered-forward":
        this.computeClusterLights(commandEncoder);
        break;
    }

    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    if (renderBundle) {
      passEncoder.executeBundles([renderBundle]);
    }

    if (this.lightManager.render) {
      // Last, render a sprite for all of the lights. This is done using instancing so it's a single
      // call for every light.
      passEncoder.setPipeline(this.lightSpritePipeline);
      passEncoder.setBindGroup(BIND_GROUP.Frame, this.bindGroups.frame);
      passEncoder.draw(4, this.lightManager.lightCount, 0, 0);
    }

    passEncoder.endPass();
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }
}