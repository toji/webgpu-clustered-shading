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

import { createShaderModuleDebug } from './wgsl-utils.js';
import { ATTRIB_MAP, UNIFORM_SET, SimpleVertexSource } from './shaders/common.js';

// A utility class that creates render bundles for a set of shaders and a list of primitives.
export class RenderBundleHelper {
  constructor(device, renderBundleDescriptor, bindGroupLayouts) {
    this.device = device;
    this.renderBundleDescriptor = renderBundleDescriptor;
    this.pipelineLayout = this.createPipelineLayout(bindGroupLayouts);

    this.nextShaderModuleId = 0;
    this.shaderModuleCache = new Map(); // Map<String -> ShaderModule>

    this.nextPipelineId = 0;
    this.pipelineCache = new Map(); // Map<String -> GPURenderPipeline>
  }

  createPipelineLayout(bindGroupLayouts) {
    // Override per-technique if needed
    return this.device.createPipelineLayout({
      bindGroupLayouts: [
        bindGroupLayouts.frame,
        bindGroupLayouts.material,
        bindGroupLayouts.primitive,
      ]
    });
  }

  getDefinesForPrimitive(primitive) {
    return {}; // Override per-technique
  }

  getVertexSource(defines) {
    return SimpleVertexSource; // Override per-technique
  }

  getFragmentSource(defines) {
    return null; // Override per-technique
  }

  getShaderModules(primitive) {
    const programDefines = this.getDefinesForPrimitive(primitive);
    let shaderModuleKey = '';
    for (let define in programDefines) {
      shaderModuleKey += `${define}=${programDefines[define]},`;
    }

    let shaderModule = this.shaderModuleCache.get(shaderModuleKey);
    if (!shaderModule) {
      const vertexSource = this.getVertexSource(programDefines);
      const fragmentSource = this.getFragmentSource(programDefines);
      if (!vertexSource) {
        throw new Error('RenderBundleHelper did not supply a valid vertex shader.');
      }
      shaderModule = {
        id: this.nextShaderModuleId++,
        vertexStage: { module: createShaderModuleDebug(this.device, vertexSource), entryPoint: 'main' },
        fragmentStage: fragmentSource ? { module: createShaderModuleDebug(this.device, fragmentSource), entryPoint: 'main' } : null,
      };
      this.shaderModuleCache.set(shaderModuleKey, shaderModule);
    }
    return shaderModule;
  }

  getPrimitivePipeline(primitive) {
    const material = primitive.material;
    const shaderModule = this.getShaderModules(primitive);
    const primitiveTopology = primitive.gpuPrimitiveTopology;

    const vertexState = primitive.getVertexStateDescriptor(ATTRIB_MAP);

    const cullMode = material.cullFace ? 'back' : 'none';
    const colorBlend = {};
    if (material.blend) {
      colorBlend.srcFactor = 'src-alpha';
      colorBlend.dstFactor = 'one-minus-src-alpha';
    }

    // Generate a key that describes this pipeline's layout/state
    let pipelineKey = `${shaderModule.id}|${primitiveTopology}|${cullMode}|${material.blend}|${vertexState.hash}`;
    let cachedPipeline = this.pipelineCache.get(pipelineKey);

    if (!cachedPipeline) {
      const pipeline = this.device.createRenderPipeline({
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
          format: this.renderBundleDescriptor.colorFormats[0],
          colorBlend,
        }],
        depthStencilState: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: this.renderBundleDescriptor.depthStencilFormat,
        },
        sampleCount: this.renderBundleDescriptor.sampleCount,
      });

      cachedPipeline = {
        id: this.nextPipelineId++,
        opaque: !material.blend,
        pipeline
      };

      this.pipelineCache.set(pipelineKey, cachedPipeline);
    }

    return cachedPipeline;
  }

  createRenderBundle(primitives, frameBindGroups) {
    // Generate a render bundle that draws all the given primitives with the specified technique.
    // The sort up front is a bit heavy, but that's OK because the end result is a render bundle
    // will excute very quickly.
    const opaquePipelines = new Map(); // Map<id -> CachedPipeline>;
    const blendedPipelines = new Map(); // Map<id -> CachedPipeline>;
    const pipelineMaterials = new Map(); // WeakMap<id -> Map<Material -> Primitive[]>>

    for (const primitive of primitives) {
      const cachedPipeline = this.getPrimitivePipeline(primitive);

      if (cachedPipeline.opaque) {
        opaquePipelines.set(cachedPipeline.id, cachedPipeline.pipeline);
      } else {
        blendedPipelines.set(cachedPipeline.id, cachedPipeline.pipeline);
      }

      let materialPrimitiveMap = pipelineMaterials.get(cachedPipeline.pipeline);
      if (!materialPrimitiveMap) {
        materialPrimitiveMap = new Map(); // Map<Material -> Primitive[]>
        pipelineMaterials.set(cachedPipeline.pipeline, materialPrimitiveMap);
      }

      const materialBindGroup = primitive.material.renderData.gpuBindGroup;

      let materialPrimitives = materialPrimitiveMap.get(materialBindGroup);
      if (!materialPrimitives) {
        materialPrimitives = [];
        materialPrimitiveMap.set(materialBindGroup, materialPrimitives);
      }

      materialPrimitives.push(primitive);
    }

    // Create a bundle we can use to replay our scene drawing each frame
    const renderBundleEncoder = this.device.createRenderBundleEncoder(this.renderBundleDescriptor);

    for (let bindGroupSet in frameBindGroups) {
      renderBundleEncoder.setBindGroup(bindGroupSet, frameBindGroups[bindGroupSet]);
    }

    // Opaque primitives first
    for (let pipeline of opaquePipelines.values()) {
      const materialPrimitives = pipelineMaterials.get(pipeline);
      this.drawPipelinePrimitives(renderBundleEncoder, pipeline, materialPrimitives);
    }

    // Blended primitives next
    for (let pipeline of blendedPipelines.values()) {
      const materialPrimitives = pipelineMaterials.get(pipeline);
      this.drawPipelinePrimitives(renderBundleEncoder, pipeline, materialPrimitives);
    }

    return renderBundleEncoder.finish();
  }

  drawPipelinePrimitives(encoder, pipeline, materialPrimitives) {
    encoder.setPipeline(pipeline);

    for (let [materialBindGroup, primitives] of materialPrimitives) {
      encoder.setBindGroup(UNIFORM_SET.Material, materialBindGroup);

      for (let primitive of primitives) {
        encoder.setBindGroup(UNIFORM_SET.Primitive, primitive.renderData.gpuBindGroup);

        let i = 0;
        for (let bufferView of primitive.attributeBuffers.keys()) {
          encoder.setVertexBuffer(i, bufferView.renderData.gpuBuffer);
          i++;
        }

        if (primitive.indices) {
          encoder.setIndexBuffer(primitive.indices.bufferView.renderData.gpuBuffer,
                                     primitive.indices.gpuType, primitive.indices.byteOffset);
                                     encoder.drawIndexed(primitive.elementCount, 1, 0, 0, 0);
        } else {
          encoder.draw(primitive.elementCount, 1, 0, 0);
        }
      }
    }
  }
}
