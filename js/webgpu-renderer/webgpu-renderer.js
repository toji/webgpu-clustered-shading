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

// This import installs hooks that help us output better formatted shader errors
import './wgsl-debug-helper.js';

import { Renderer } from '../renderer.js';
import { ProjectionUniformsSize, ViewUniformsSize, BIND_GROUP } from './shaders/common.js';
import { PBRRenderBundleHelper, PBRClusteredRenderBundleHelper } from './pbr-render-bundle-helper.js';
import { DepthVisualization, DepthSliceVisualization, ClusterDistanceVisualization, LightsPerClusterVisualization } from './debug-visualizations.js';
import { LightSpriteVertexSource, LightSpriteFragmentSource } from './shaders/light-sprite.js';
import { vec2, vec3, vec4 } from '../third-party/gl-matrix/dist/esm/index.js';
import { WebGPUTextureLoader } from '../third-party/web-texture-tool/build/webgpu-texture-loader.js';

import { ClusterBoundsSource, ClusterLightsSource, DISPATCH_SIZE, TOTAL_TILES, CLUSTER_LIGHTS_SIZE } from './shaders/clustered-compute.js';

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";

// Can reuse these for every PBR material
const materialUniforms = new Float32Array(4 + 4 + 4);
const baseColorFactor = new Float32Array(materialUniforms.buffer, 0, 4);
const metallicRoughnessFactor = new Float32Array(materialUniforms.buffer, 4 * 4, 2);
const emissiveFactor = new Float32Array(materialUniforms.buffer, 8 * 4, 3);

const emptyArray = new Uint32Array(1);

export class WebGPURenderer extends Renderer {
  constructor() {
    super();

    this.context = this.canvas.getContext('webgpu');

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

    // Enable compressed textures if available
    const requiredFeatures = [];
    if (this.adapter.features.has('texture-compression-bc') != -1) {
      requiredFeatures.push('texture-compression-bc');
    }

    this.device = await this.adapter.requestDevice({requiredFeatures});

    this.contextFormat = this.context.getPreferredFormat(this.adapter);

    this.renderBundleDescriptor = {
      colorFormats: [ this.contextFormat ],
      depthStencilFormat: DEPTH_FORMAT,
      sampleCount: SAMPLE_COUNT
    };

    // Just for debugging my shader helper stuff. This is expected to fail.
    /*this.device.createShaderModule({
      label: 'Test Shader',
      code: `
        // 頂点シェーダー
        @stage(vertex)
        fn main(@location(0) inPosition : vec3) -> @builtin(position) vec4<f32> {
          return vec3<f32>(inPosition, 1.0);
        }
      `
    });*/

    this.textureLoader = new WebGPUTextureLoader(this.device);

    this.colorAttachment = {
      // view is acquired and set in onResize.
      view: undefined,
      // renderTarget is acquired and set in onFrame.
      resolveTarget: undefined,
      loadValue: { r: 0.0, g: 0.0, b: 0.5, a: 1.0 },
      storeOp: 'discard',
    };

    this.depthAttachment = {
      // view is acquired and set in onResize.
      view: undefined,
      depthLoadValue: 1.0,
      depthStoreOp: 'discard',
      stencilLoadValue: 0,
      stencilStoreOp: 'discard',
    };

    this.renderPassDescriptor = {
      colorAttachments: [this.colorAttachment],
      depthStencilAttachment: this.depthAttachment
    };

    this.bindGroupLayouts = {
      frame: this.device.createBindGroupLayout({
        label: `frame-bgl`,
        entries: [{
          binding: 0, // Projection uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: {},
        }, {
          binding: 1, // View uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
          buffer: {}
        }, {
          binding: 2, // Light uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        }, {
          binding: 3, // Cluster Lights storage
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }
        }]
      }),

      material: this.device.createBindGroupLayout({
        label: `material-bgl`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {}
        },
        {
          binding: 1, // defaultSampler
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 2, // baseColorTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 3, // normalTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 4, // metallicRoughnessTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 5, // occlusionTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 6, // emissiveTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }]
      }),

      primitive: this.device.createBindGroupLayout({
        label: `primitive-bgl`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {}
        }]
      }),

      cluster: this.device.createBindGroupLayout({
        label: `cluster-bgl`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
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
      size: CLUSTER_LIGHTS_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
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

    this.blackTextureView = this.textureLoader.fromColor(0, 0, 0, 0).texture.createView();
    this.whiteTextureView = this.textureLoader.fromColor(1.0, 1.0, 1.0, 1.0).texture.createView();
    this.blueTextureView = this.textureLoader.fromColor(0, 0, 1.0, 0).texture.createView();

    // Setup a render pipeline for drawing the light sprites
    this.lightSpritePipeline = this.device.createRenderPipeline({
      label: `light-sprite-pipeline`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.bindGroupLayouts.frame, // set 0
        ]
      }),
      vertex: {
        module: this.device.createShaderModule({
          code: LightSpriteVertexSource,
          label: 'Light Sprite'
        }),
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: this.device.createShaderModule({
          code: LightSpriteFragmentSource,
          label: 'Light Sprite'
        }),
        entryPoint: 'fragmentMain',
        targets: [{
          format: this.contextFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one",
            },
          },
        }],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: 'uint32'
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: DEPTH_FORMAT,
      },
      multisample: {
        count: SAMPLE_COUNT,
      }
    });
  }

  onResize(width, height) {
    if (!this.device) return;

    this.context.configure({
      device: this.device,
      format: this.contextFormat,
      size: {width, height}
    });

    const msaaColorTexture = this.device.createTexture({
      size: { width, height },
      sampleCount: SAMPLE_COUNT,
      format: this.contextFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.colorAttachment.view = msaaColorTexture.createView();

    const depthTexture = this.device.createTexture({
      size: { width, height },
      sampleCount: SAMPLE_COUNT,
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthAttachment.view = depthTexture.createView();

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

    this.outputRenderBundles = {};
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
    this.device.queue.submit([commandEncoder.finish()]);
  }

  async initImage(image) {
    const result = await this.textureLoader.fromBlob(await image.blob, {colorSpace: image.colorSpace});
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

    this.device.queue.writeBuffer(materialBuffer, 0, materialUniforms);

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

      this.device.queue.writeBuffer(modelBuffer, 0, primitive.renderData.instances[0]);

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
          buffer: { type: 'storage' }
        }]
      });

      this.clusterPipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [
            this.bindGroupLayouts.frame, // set 0
            clusterStorageBindGroupLayout, // set 1
          ]
        }),
        compute: {
          module: this.device.createShaderModule({ code: ClusterBoundsSource, label: "Cluster Bounds" }),
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
    this.device.queue.writeBuffer(this.projectionBuffer, 0, this.frameUniforms.buffer, 0, ProjectionUniformsSize);

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.bindGroups.frame);
    passEncoder.setBindGroup(1, this.clusterStorageBindGroup);
    passEncoder.dispatch(...DISPATCH_SIZE);
    passEncoder.endPass();
    this.device.queue.submit([commandEncoder.finish()]);
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
        compute: {
          module: this.device.createShaderModule({ code: ClusterLightsSource, label: "Cluster Lights" }),
          entryPoint: 'main',
        }
      });
    }

    // Reset the light offset counter to 0 before populating the light clusters.
    this.device.queue.writeBuffer(this.clusterLightsBuffer, 0, emptyArray);

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.clusterLightsPipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, this.bindGroups.frame);
    passEncoder.setBindGroup(1, this.bindGroups.cluster);
    passEncoder.dispatch(...DISPATCH_SIZE);
    passEncoder.endPass();
  }

  onFrame(timestamp) {
    // TODO: If we want multisampling this should attach to the resolveTarget,
    // but there seems to be a bug with that right now?
    this.colorAttachment.resolveTarget = this.context.getCurrentTexture().createView();

    // Update the View uniforms buffer with the values. These are used by most shader programs
    // and don't change for the duration of the frame.
    this.device.queue.writeBuffer(this.viewBuffer, 0, this.frameUniforms.buffer, ProjectionUniformsSize, ViewUniformsSize);

    // Update the light unform buffer with the latest values as well.
    this.device.queue.writeBuffer(this.lightsBuffer, 0, this.lightManager.uniformArray);

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
    this.device.queue.submit([commandEncoder.finish()]);
  }
}