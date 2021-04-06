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

import { RenderPipelineCache } from './render-pipeline-cache.js';
import { ATTRIB_MAP, BIND_GROUP, SimpleVertexSource } from './shaders/common.js';

// A utility class that creates render bundles for a set of shaders and a list of primitives.
export class RenderBundleHelper {
  constructor(renderer) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.renderBundleDescriptor = renderer.renderBundleDescriptor;
    this.pipelineLayout = this.createPipelineLayout(renderer.bindGroupLayouts);

    this.nextShaderModuleId = 0;
    this.shaderModuleCache = new Map(); // Map<String -> ShaderModule>

    this.pipelineCache = new RenderPipelineCache(renderer.device);
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
        vertex: this.device.createShaderModule({ code: vertexSource }),
        fragment: fragmentSource ? this.device.createShaderModule({ code: fragmentSource }) : null,
      };
      this.shaderModuleCache.set(shaderModuleKey, shaderModule);
    }
    return shaderModule;
  }

  getPrimitivePipeline(primitive) {
    const material = primitive.material;
    const shaderModule = this.getShaderModules(primitive);
    const pipelineDescriptor = primitive.getPartialRenderPipelineDescriptor(ATTRIB_MAP);

    const colorBlend = {};
    if (material.blend) {
      colorBlend.srcFactor = 'src-alpha';
      colorBlend.dstFactor = 'one-minus-src-alpha';
    }

    pipelineDescriptor.vertex.module = shaderModule.vertex;
    pipelineDescriptor.vertex.entryPoint = "main";

    Object.assign(pipelineDescriptor, {
      layout: this.pipelineLayout,
      fragment: {
        module: shaderModule.fragment,
        entryPoint: "main",
        targets: [{
          format: this.renderBundleDescriptor.colorFormats[0],
          blend: {
            color: colorBlend,
            alpha: {
              srcFactor: "one",
              dstFactor: "one",
            }
          },
        }]
      },
      depthStencil: {
        format: this.renderBundleDescriptor.depthStencilFormat,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: {
        count: this.renderBundleDescriptor.sampleCount
      }
    });

    return this.pipelineCache.getRenderPipeline(pipelineDescriptor);
  }

  setFrameBindGroups(renderBundleEncoder) {
    renderBundleEncoder.setBindGroup(BIND_GROUP.Frame, this.renderer.bindGroups.frame);
  }

  createRenderBundle(primitives) {
    // Generate a render bundle that draws all the given primitives with the specified technique.
    // The sort up front is a bit heavy, but that's OK because the end result is a render bundle
    // will excute very quickly.
    const opaquePipelines = new Map(); // Map<id -> CachedPipeline>;
    const blendedPipelines = new Map(); // Map<id -> CachedPipeline>;
    const pipelineMaterials = new Map(); // WeakMap<id -> Map<Material -> Primitive[]>>

    for (const primitive of primitives) {
      const pipeline = this.getPrimitivePipeline(primitive);

      if (primitive.material.blend) {
        blendedPipelines.set(pipeline.renderPipelineCacheHash, pipeline);
      } else {
        opaquePipelines.set(pipeline.renderPipelineCacheHash, pipeline);
      }

      let materialPrimitiveMap = pipelineMaterials.get(pipeline);
      if (!materialPrimitiveMap) {
        materialPrimitiveMap = new Map(); // Map<Material -> Primitive[]>
        pipelineMaterials.set(pipeline, materialPrimitiveMap);
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

    this.setFrameBindGroups(renderBundleEncoder);

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
      encoder.setBindGroup(BIND_GROUP.Material, materialBindGroup);

      for (let primitive of primitives) {
        encoder.setBindGroup(BIND_GROUP.Model, primitive.renderData.gpuBindGroup);

        let i = 0;
        for (let [bufferView, bufferAttributes] of primitive.attributeBuffers) {
          encoder.setVertexBuffer(i, bufferView.renderData.gpuBuffer, bufferAttributes.minAttributeByteOffset);
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
