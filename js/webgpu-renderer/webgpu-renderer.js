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
import { GPUTextureHelper } from './webgpu-texture-helper.js';
import { WEBGPU_VERTEX_SOURCE, WEBGPU_FRAGMENT_SOURCE, ATTRIB_MAP, GetDefinesForPrimitive } from './pbr-shader-wgsl.js';
import { vec2, vec3, vec4, mat4 } from '../third-party/gl-matrix/src/gl-matrix.js';

import glslangModule from 'https://unpkg.com/@webgpu/glslang@0.0.7/web/glslang.js';

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";
const GENERATE_MIPMAPS = true;

// Only used for comparing values from glTF, which uses WebGL enums natively.
const GL = WebGLRenderingContext;

let NEXT_SHADER_ID = 0;

function logWithNumberedLines(codeSrc) {
  const lines = codeSrc.split('\n');
  let lineNum = 1;
  let outSrc = '';
  for (const line of lines) {
    outSrc += `${lineNum}: ${line}\n`;
    lineNum++;
  }

  console.log(outSrc);
}

const SHADER_ERROR_REGEX = /([0-9]*):([0-9*]*): (.*)$/gm;

function createShaderModuleDebug(device, code) {
  device.pushErrorScope('validation');

  const shaderModule = device.createShaderModule({ code });

  device.popErrorScope().then((error) => {
    if (error) {
      const codeLines = code.split('\n');

      const errorList = error.message.matchAll(SHADER_ERROR_REGEX);

      // If no parsable errors were found, just print the whole message.
      if (!errorList) {
        console.error(error.message);
        return;
      }

      // Otherwise loop through the parsed error messages and show the relevant source code for
      // each message.
      let errorMessage = '';
      let errorStyles = [];

      let lastIndex = 0;

      for (const errorMatch of errorList) {
        // Include out any content between the parsable lines
        if (errorMatch.index > lastIndex+1) {
          errorMessage += error.message.substring(lastIndex, errorMatch.index);
        }
        lastIndex = errorMatch.index + errorMatch[0].length;

        // Show the correlated line with an arrow that points at the indicated error position.
        const errorLine = parseInt(errorMatch[1], 10)-1;
        const errorChar = parseInt(errorMatch[2], 10);
        const errorPointer = '-'.repeat(errorChar-1) + '^';
        errorMessage += `${errorMatch[0]}\n%c${codeLines[errorLine]}\n%c${errorPointer}%c\n`;
        errorStyles.push(
          'color: grey;',
          'color: green; font-weight: bold;',
          'color: default;',
        );

      }

      // Include any trailing content.
      if (error.message.length > lastIndex+1) {
        errorMessage += error.message.substring(lastIndex+1, error.message.length);
      }

      console.error(errorMessage, ...errorStyles);
    }
  });

  return shaderModule;
}

class PBRShaderModule {
  constructor(device, glslang, defines) {
    this.id = NEXT_SHADER_ID++;

    this.vertexStage = {
      module: createShaderModuleDebug(device, WEBGPU_VERTEX_SOURCE(defines)),
      entryPoint: 'main'
    };

    this.fragmentStage = {
      module: createShaderModuleDebug(device, WEBGPU_FRAGMENT_SOURCE(defines)),
      entryPoint: 'main'
    };
  }
}

const LightSprite = {
  vertexCount: 4,

  vertexSource: `
  var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0)
  );

  [[block]] struct FrameUniforms {
    [[offset(0)]] projectionMatrix : mat4x4<f32>;
    [[offset(64)]] viewMatrix : mat4x4<f32>;
    [[offset(128)]] cameraPosition : vec3<f32>;
  };
  [[binding(0), set(0)]] var<uniform> frame : FrameUniforms;

  struct Light {
    [[offset(0)]] position : vec3<f32>;
    [[offset(16)]] color : vec3<f32>;
  };

  [[block]] struct LightUniforms {
    [[offset(0)]] lights : [[stride(32)]] array<Light, 5>;
    [[offset(160)]] lightAmbient : f32;
  };
  [[binding(1), set(0)]] var<uniform> light : LightUniforms;

  [[location(0)]] var<out> vPos : vec2<f32>;
  [[location(1)]] var<out> vColor : vec3<f32>;

  [[builtin(position)]] var<out> outPosition : vec4<f32>;
  [[builtin(vertex_idx)]] var<in> vertexIndex : i32;
  [[builtin(instance_idx)]] var<in> instanceIndex : i32;

  [[stage(vertex)]]
  fn main() -> void {
    const lightSize : f32 = 0.2;

    vPos = pos[vertexIndex];
    vColor = light.lights[instanceIndex].color;
    var worldPos : vec3<f32> = vec3<f32>(vPos, 0.0) * lightSize;

    # Generate a billboarded model view matrix
    var bbModelViewMatrix : mat4x4<f32>;
    bbModelViewMatrix[3] = vec4<f32>(light.lights[instanceIndex].position, 1.0);
    bbModelViewMatrix = frame.viewMatrix * bbModelViewMatrix;
    bbModelViewMatrix[0][0] = 1.0;
    bbModelViewMatrix[0][1] = 0.0;
    bbModelViewMatrix[0][2] = 0.0;

    bbModelViewMatrix[1][0] = 0.0;
    bbModelViewMatrix[1][1] = 1.0;
    bbModelViewMatrix[1][2] = 0.0;

    bbModelViewMatrix[2][0] = 0.0;
    bbModelViewMatrix[2][1] = 0.0;
    bbModelViewMatrix[2][2] = 1.0;

    outPosition = frame.projectionMatrix * bbModelViewMatrix * vec4<f32>(worldPos, 1.0);
    return;
  }`,

  fragmentSource: `
  [[location(0)]] var<out> outColor : vec4<f32>;

  [[location(0)]] var<in> vPos : vec2<f32>;
  [[location(1)]] var<in> vColor : vec3<f32>;

  [[stage(fragment)]]
  fn main() -> void {
    var distToCenter : f32 = length(vPos);
    var fade : f32 = (1.0 - distToCenter) * (1.0 / (distToCenter * distToCenter));
    outColor = vec4<f32>(vColor * fade, fade);
    return;
  }`,
};

export class WebGPURenderer extends Renderer {
  constructor() {
    super();

    this.context = this.canvas.getContext('gpupresent');

    this.programs = new Map();

    this.pipelines = new Map(); // Map<String -> GPURenderPipeline>
    this.pipelineMaterials = new WeakMap(); // WeakMap<GPURenderPipeline, Map<Material, Primitive[]>>

    this.opaquePipelines = [];
    this.blendedPipelines = [];
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
        visibility: GPUShaderStage.VERTEX,
        type: 'uniform-buffer'
      }]
    });

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

    this.lightUniformsBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'uniform-buffer'
      }]
    });

    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.frameUniformsBindGroupLayout, // set 0
        this.materialUniformsBindGroupLayout, // set 1
        this.primitiveUniformsBindGroupLayout, // set 2
        this.lightUniformsBindGroupLayout, // set 3
      ]
    });

    this.frameUniformsBuffer = this.device.createBuffer({
      size: this.frameUniforms.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.lightUniformsBuffer = this.device.createBuffer({
      size: this.lightUniforms.byteLength,
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

    this.lightUniformBindGroup = this.device.createBindGroup({
      layout: this.lightUniformsBindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.lightUniformsBuffer,
        },
      }],
    });

    // TODO: Will probably need to be per-material later
    this.glslang = await glslangModule();

    this.textureHelper = new GPUTextureHelper(this.device, this.glslang);

    this.blackTextureView = this.textureHelper.generateColorTexture(0, 0, 0, 0).createView();
    this.whiteTextureView = this.textureHelper.generateColorTexture(1.0, 1.0, 1.0, 1.0).createView();
    this.blueTextureView = this.textureHelper.generateColorTexture(0, 0, 1.0, 0).createView();

    this.buildLightSprite();
  }

  buildLightSprite() {
    const lightSpriteBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        type: 'uniform-buffer'
      }, {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        type: 'uniform-buffer'
      }]
    });

    this.lightSpriteBindGroup = this.device.createBindGroup({
      layout: lightSpriteBindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.frameUniformsBuffer,
        },
      }, {
        binding: 1,
        resource: {
          buffer: this.lightUniformsBuffer,
        },
      }],
    });

    this.lightSpritePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [lightSpriteBindGroupLayout] }),
      vertexStage: {
        module: this.device.createShaderModule({
          code: LightSprite.vertexSource,
        }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: this.device.createShaderModule({
          code: LightSprite.fragmentSource,
        }),
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
          dstFactor: 'one-minus-src-alpha',
        }
        // TODO: Bend mode goes here
      }],
      depthStencilState: {
        depthWriteEnabled: true,
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

    // Create a bundle we can use to replay our scene drawing each frame
    const renderBundleEncoder = this.device.createRenderBundleEncoder({
      colorFormats: [ this.swapChainFormat ],
      depthStencilFormat: DEPTH_FORMAT,
      sampleCount: SAMPLE_COUNT
    });

    renderBundleEncoder.setBindGroup(0, this.frameUniformBindGroup);
    renderBundleEncoder.setBindGroup(3, this.lightUniformBindGroup);

    // Opaque primitives first
    for (let pipeline of this.opaquePipelines) {
      this.drawPipelinePrimitives(renderBundleEncoder, pipeline);
    }

    // Blended primitives next
    for (let pipeline of this.blendedPipelines) {
      this.drawPipelinePrimitives(renderBundleEncoder, pipeline);
    }

    // Last, render a sprite for all of the lights
    renderBundleEncoder.setPipeline(this.lightSpritePipeline);
    renderBundleEncoder.setBindGroup(0, this.lightSpriteBindGroup);
    renderBundleEncoder.draw(4, this.lightCount, 0, 0);

    this.renderBundle = renderBundleEncoder.finish();
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
    //await image.decode();
    const imageBitmap = await createImageBitmap(image);

    if (GENERATE_MIPMAPS) {
      image.gpuTextureView = this.textureHelper.generateMipmappedTexture(imageBitmap).createView();
    } else {
      image.gpuTextureView = this.textureHelper.generateTexture(imageBitmap).createView();
    }
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

    // FYI: This is how you'd do it without using writeBuffer
    /*const materialUniformsSrcBuffer = this.device.createBuffer({
      size: materialUniforms.byteLength,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    materialUniformsSrcArray = new Float32Array(materialUniformsSrcBuffer.getMappedRange());
    materialUniformsSrcArray.set(materialUniforms);
    materialUniformsSrcBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(materialUniformsSrcBuffer, 0, materialUniformsBuffer, 0, materialUniforms.byteLength);
    this.device.defaultQueue.submit([commandEncoder.finish()]);*/

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

    primitive.renderData.gpuVertexState = {
      vertexBuffers
    };

    if (primitive.indices) {
      primitive.indices.gpuType = primitive.indices.type == GL.UNSIGNED_SHORT ? 'uint16' : 'uint32';
    }

    /*if (primitive.indices && primitive.indices.type == GL.UNSIGNED_SHORT) {
      primitive.renderData.gpuVertexState.indexFormat = 'uint16';
    }*/

    const defines = GetDefinesForPrimitive(primitive);
    defines.LIGHT_COUNT = this.lightCount;

    let key = '';
    for (let define in defines) {
      key += `${define}=${defines[define]},`;
    }

    let program = this.programs.get(key);
    if (!program) {
      program = new PBRShaderModule(this.device, this.glslang, defines);
      this.programs.set(key, program);
    }

    primitive.renderData.gpuShaderModule = program;

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

      // TODO: This needs some SERIOUS de-duping
      this.createPipeline(primitive);
    }
  }

  createPipeline(primitive) {
    const material = primitive.material;
    const shaderModule = primitive.renderData.gpuShaderModule;
    const vertexState = primitive.renderData.gpuVertexState;

    let primitiveTopology;
    switch (primitive.mode) {
      case GL.TRIANGLES:
        primitiveTopology = 'triangle-list';
        break;
      case GL.TRIANGLE_STRIP:
        primitiveTopology = 'triangle-strip';
        vertexState.indexFormat = primitive.indices.gpuType;
        break;
      case GL.LINES:
        primitiveTopology = 'line-list';
        break;
      case GL.LINE_STRIP:
        primitiveTopology = 'line-strip';
        vertexState.indexFormat = primitive.indices.gpuType;
        break;
      case GL.POINTS:
        primitiveTopology = 'point-list';
        break;
      default:
        // LINE_LOOP and TRIANGLE_FAN are straight up unsupported.
        return;
    }
    const cullMode = material.cullFace ? 'back' : 'none';
    const colorBlend = {};
    if (material.blend) {
      colorBlend.srcFactor = 'src-alpha';
      colorBlend.dstFactor = 'one-minus-src-alpha';
    }

    // Generate a key that describes this pipeline's layout/state
    let pipelineKey = `${shaderModule.id}|${primitiveTopology}|${cullMode}|${material.blend}|`;
    let i = 0;
    for (let vertexBuffer of vertexState.vertexBuffers) {
      pipelineKey += `${i}:${vertexBuffer.arrayStride}`;
      for (let attribute of vertexBuffer.attributes) {
        pipelineKey += `:${attribute.shaderLocation},${attribute.offset},${attribute.format}`;
      }
      pipelineKey += '|'
      i++;
    }

    if (vertexState.indexFormat) {
      pipelineKey += `${vertexState.indexFormat}`;
    }

    let pipeline = this.pipelines.get(pipelineKey);

    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        vertexStage: shaderModule.vertexStage,
        fragmentStage: shaderModule.fragmentStage,

        primitiveTopology,

        vertexState,

        rasterizationState: {
          cullMode,
        },

        // Everything below here is (currently) identical for each pipeline
        layout: this.pipelineLayout,
        colorStates: [{
          format: this.swapChainFormat,
          colorBlend
          // TODO: Bend mode goes here
        }],
        depthStencilState: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: DEPTH_FORMAT,
        },
        sampleCount: SAMPLE_COUNT,
      });

      this.pipelines.set(pipelineKey, pipeline);
      if (material.blend) {
        this.blendedPipelines.push(pipeline);
      } else {
        this.opaquePipelines.push(pipeline);
      }
      this.pipelineMaterials.set(pipeline, new Map());
    }

    let pipelineMaterialPrimitives = this.pipelineMaterials.get(pipeline);

    let materialPrimitives = pipelineMaterialPrimitives.get(primitive.material);
    if (!materialPrimitives) {
      materialPrimitives = [];
      pipelineMaterialPrimitives.set(primitive.material, materialPrimitives);
    }

    materialPrimitives.push(primitive);
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

  onFrame(timestamp) {
    // TODO: If we want multisampling this should attach to the resolveTarget,
    // but there seems to be a bug with that right now?
    this.colorAttachment.resolveTarget = this.swapChain.getCurrentTexture().createView();

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    this.device.defaultQueue.writeBuffer(this.frameUniformsBuffer, 0, this.frameUniforms);

    // Update the light unforms as well
    this.device.defaultQueue.writeBuffer(this.lightUniformsBuffer, 0, this.lightUniforms);

    const commandEncoder = this.device.createCommandEncoder({});

    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    if (this.renderBundle) {
      passEncoder.executeBundles([this.renderBundle]);
    }

    passEncoder.endPass();
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }

  drawPipelinePrimitives(passEncoder, pipeline) {
    passEncoder.setPipeline(pipeline);
    const materialPrimitives = this.pipelineMaterials.get(pipeline);
    for (let [material, primitives] of materialPrimitives) {
      passEncoder.setBindGroup(1, material.renderData.gpuBindGroup);

      for (let primitive of primitives) {
        passEncoder.setBindGroup(2, primitive.renderData.gpuBindGroup);

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