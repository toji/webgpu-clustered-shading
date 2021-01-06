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

import { RenderBundleHelper } from './render-bundle-helper.js';
import { PBRVertexSource, PBRFragmentSource, PBRClusteredFragmentSource } from './shaders/pbr.js';

export class PBRRenderBundleHelper extends RenderBundleHelper {
  constructor(renderer) {
    super(renderer);
  }

  getDefinesForPrimitive(primitive) {
    const attributes = primitive.enabledAttributes;
    const material = primitive.material;
    const programDefines = {};

    if (attributes.has('COLOR_0')) {
      programDefines['USE_VERTEX_COLOR'] = 1;
    }

    if (attributes.has('TEXCOORD_0')) {
      if (material.baseColorTexture) {
        programDefines['USE_BASE_COLOR_MAP'] = 1;
      }

      if (material.normalTexture && (attributes.has('TANGENT'))) {
        programDefines['USE_NORMAL_MAP'] = 1;
      }

      if (material.metallicRoughnessTexture) {
        programDefines['USE_METAL_ROUGH_MAP'] = 1;
      }

      if (material.occlusionTexture) {
        programDefines['USE_OCCLUSION'] = 1;
      }

      if (material.emissiveTexture) {
        programDefines['USE_EMISSIVE_TEXTURE'] = 1;
      }
    }

    if ((!material.metallicRoughnessTexture ||
          !(attributes.has('TEXCOORD_0'))) &&
          material.metallicRoughnessFactor[1] == 1.0) {
      programDefines['FULLY_ROUGH'] = 1;
    }

    return programDefines;
  }

  getVertexSource(defines) { return PBRVertexSource(defines); }
  getFragmentSource(defines) { return PBRFragmentSource(defines); }
}

export class PBRClusteredRenderBundleHelper extends PBRRenderBundleHelper {
  getFragmentSource(defines) { return PBRClusteredFragmentSource(defines); }
}