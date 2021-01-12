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

import { vec2, vec3, vec4, mat4 } from './third-party/gl-matrix/dist/esm/index.js';

// Used for comparing values from glTF files, which uses WebGL enums natively.
const GL = WebGLRenderingContext;

const GLB_MAGIC = 0x46546C67;
const CHUNK_TYPE = {
  JSON: 0x4E4F534A,
  BIN: 0x004E4942,
};
const DEFAULT_TRANSLATION = vec3.fromValues(0, 0, 0);
const DEFAULT_ROTATION = vec4.fromValues(0, 0, 0, 1);
const DEFAULT_SCALE = vec3.fromValues(1, 1, 1);
const DEFAULT_BASE_COLOR_FACTOR = vec4.fromValues(1, 1, 1, 1);
const DEFAULT_EMISSIVE_FACTOR = vec3.fromValues(0, 0, 0);

function isAbsoluteUri(uri) {
  let absRegEx = new RegExp(`^${window.location.protocol}`, 'i');
  return !!uri.match(absRegEx);
}

function isDataUri(uri) {
  let dataRegEx = /^data:/;
  return !!uri.match(dataRegEx);
}

function resolveUri(uri, baseUrl) {
  if (isAbsoluteUri(uri) || isDataUri(uri)) {
      return uri;
  }
  return baseUrl + uri;
}

function getComponentCount(type) {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    default: return 0;
  }
}

function getComponentTypeSize(componentType) {
  switch (componentType) {
    case GL.BYTE: return 1;
    case GL.UNSIGNED_BYTE: return 1;
    case GL.SHORT: return 2;
    case GL.UNSIGNED_SHORT: return 2;
    case GL.UNSIGNED_INT: return 4;
    case GL.FLOAT: return 4;
    default: return 0;
  }
}

/**
 * Gltf2Loader
 * Loads glTF 2.0 scenes into a more gpu-ready structure.
 */

export class Gltf2Loader {
  constructor() {
  }

  async loadFromUrl(url) {
    const i = url.lastIndexOf('/');
    const baseUrl = (i !== 0) ? url.substring(0, i + 1) : '';
    const response = await fetch(url);

    if (url.endsWith('.gltf')) {
      return this.loadFromJson(await response.json(), baseUrl);
    } else if (url.endsWith('.glb')) {
      return this.loadFromBinary(await response.arrayBuffer(), baseUrl);
    } else {
      throw new Error('Unrecognized file extension');
    }
  }

  loadFromBinary(arrayBuffer, baseUrl) {
    let headerView = new DataView(arrayBuffer, 0, 12);
    let magic = headerView.getUint32(0, true);
    let version = headerView.getUint32(4, true);
    let length = headerView.getUint32(8, true);

    if (magic != GLB_MAGIC) {
      throw new Error('Invalid magic string in binary header.');
    }

    if (version != 2) {
      throw new Error('Incompatible version in binary header.');
    }

    let chunks = {};
    let chunkOffset = 12;
    while (chunkOffset < length) {
      let chunkHeaderView = new DataView(arrayBuffer, chunkOffset, 8);
      let chunkLength = chunkHeaderView.getUint32(0, true);
      let chunkType = chunkHeaderView.getUint32(4, true);
      chunks[chunkType] = arrayBuffer.slice(chunkOffset + 8, chunkOffset + 8 + chunkLength);
      chunkOffset += chunkLength + 8;
    }

    if (!chunks[CHUNK_TYPE.JSON]) {
      throw new Error('File contained no json chunk.');
    }

    let decoder = new TextDecoder('utf-8');
    let jsonString = decoder.decode(chunks[CHUNK_TYPE.JSON]);
    let json = JSON.parse(jsonString);
    return this.loadFromJson(json, baseUrl, chunks[CHUNK_TYPE.BIN]);
  }

  async loadFromJson(json, baseUrl, binaryChunk) {
    if (!json.asset) {
      throw new Error('Missing asset description.');
    }

    if (json.asset.minVersion != '2.0' && json.asset.version != '2.0') {
      throw new Error('Incompatible asset version.');
    }

    const gltf = new Gltf2();
    const resourcePromises = [];

    // Buffers
    if (binaryChunk) {
      gltf.buffers.push(Promise.resolve(binaryChunk));
    } else {
      for (let buffer of json.buffers) {
        if (isDataUri(buffer.uri)) {
          let base64String = buffer.uri.replace('data:application/octet-stream;base64,', '');
          let binaryArray = Uint8Array.from(atob(base64String), (c) => c.charCodeAt(0));
          gltf.buffers.push(Promise.resolve(binaryArray.buffer));
        } else {
          let uri = resolveUri(buffer.uri, baseUrl);
          gltf.buffers.push(fetch(uri).then((response) => response.arrayBuffer()));
        }
      }

      resourcePromises.push(...gltf.buffers);
    }

    // Buffer Views
    for (let bufferView of json.bufferViews) {
      gltf.bufferViews.push(new BufferView(
        gltf.buffers[bufferView.buffer],
        bufferView.byteStride,
        bufferView.byteOffset,
        bufferView.byteLength
      ));
    }

    // Images
    if (json.images) {
      for (let image of json.images) {
        if (image.uri) {
          if (isDataUri(image.uri)) {
            //imgElement.src = image.uri;
            gltf.images.push(fetch(`${image.uri}`).then(async (response) => {
              return await response.blob();
            }));
          } else {
            gltf.images.push(fetch(`${baseUrl}${image.uri}`).then(async (response) => {
              return await response.blob();
            }));
          }
        } else {
          let bufferView = gltf.bufferViews[image.bufferView];
          bufferView.usage.add('image');
          gltf.images.push(bufferView.dataView.then((dataView) => {
            return new Blob([dataView], {type: image.mimeType});
          }));
        }
      }

      resourcePromises.push(...gltf.images);
    }

    // Samplers
    if (json.samplers) {
      for (let sampler of json.samplers) {
        gltf.samplers.push(new Sampler(
          sampler.magFilter,
          sampler.minFilter,
          sampler.wrapS,
          sampler.wrapT
        ));
      }
    }

    // Textures
    let defaultSampler = null;
    if (json.textures) {
      for (let texture of json.textures) {
        let sampler = null;
        if (texture.sampler) {
          sampler = gltf.samplers[texture.sampler];
        } else {
          // Use a default sampler if the texture has none.
          if (!defaultSampler) {
            defaultSampler = new Sampler();
            gltf.samplers.push(defaultSampler);
          }
          sampler = defaultSampler;
        }
        if (texture.extensions && texture.extensions.KHR_texture_basisu) {
          gltf.textures.push(new Texture(gltf.images[texture.extensions.KHR_texture_basisu.source], sampler));
        } else {
          gltf.textures.push(new Texture(gltf.images[texture.source], sampler));
        }

      }
    }

    function getTexture(textureInfo) {
      if (!textureInfo) {
        return null;
      }
      return gltf.textures[textureInfo.index];
    }

    // Materials
    let defaultMaterial = null;
    if (json.materials) {
      for (let material of json.materials) {
        let glMaterial = new Material();
        let pbr = material.pbrMetallicRoughness || {};

        glMaterial.baseColorFactor = vec4.clone(pbr.baseColorFactor || DEFAULT_BASE_COLOR_FACTOR);
        glMaterial.baseColorTexture = getTexture(pbr.baseColorTexture);
        glMaterial.metallicRoughnessFactor = vec2.clone([
          pbr.metallicFactor || 1.0,
          pbr.roughnessFactor || 1.0,
        ]);
        glMaterial.metallicRoughnessTexture = getTexture(pbr.metallicRoughnessTexture);
        glMaterial.normalTexture = getTexture(material.normalTexture);
        glMaterial.occlusionTexture = getTexture(material.occlusionTexture);
        glMaterial.occlusionStrength = (material.occlusionTexture && material.occlusionTexture.strength) ?
                                        material.occlusionTexture.strength : 1.0;
        glMaterial.emissiveFactor = vec3.clone(material.emissiveFactor || DEFAULT_EMISSIVE_FACTOR);
        glMaterial.emissiveTexture = getTexture(material.emissiveTexture);

        switch (material.alphaMode) {
          case 'BLEND':
            glMaterial.blend = true;
            break;
          case 'MASK':
            // Not really supported.
            glMaterial.blend = true;
            break;
          default: // Includes 'OPAQUE'
            glMaterial.blend = false;
        }

        // glMaterial.alpha_cutoff = material.alphaCutoff;
        glMaterial.cullFace = !material.doubleSided;

        gltf.materials.push(glMaterial);
      }
    }

    let accessors = json.accessors;

    // Meshes
    const meshes = [];
    for (let mesh of json.meshes) {
      let primitives = []; // A mesh in glTF is just an array of primitives
      meshes.push(primitives);

      for (let primitive of mesh.primitives) {
        let material = null;
        if ('material' in primitive) {
          material = gltf.materials[primitive.material];
        } else {
          // Use a "default" material if the primitive has none.
          if (!defaultMaterial) {
            defaultMaterial = new Material();
            gltf.materials.push(defaultMaterial);
          }
          material = defaultMaterial;
        }

        let elementCount = 0;

        let attributeBuffers = new Map();
        for (let name in primitive.attributes) {
          let accessor = accessors[primitive.attributes[name]];
          elementCount = accessor.count;

          const bufferView = gltf.bufferViews[accessor.bufferView];
          bufferView.usage.add('vertex');

          let bufferAttributes = attributeBuffers.get(bufferView);
          if (!bufferAttributes) {
            bufferAttributes = new PrimitiveBufferAttributes(bufferView);
            attributeBuffers.set(bufferView, bufferAttributes);
          }

          bufferAttributes.addAttribute(name, new PrimitiveAttribute(
            getComponentCount(accessor.type),
            accessor.componentType,
            accessor.byteOffset,
            accessor.normalized
          ));
        }

        let indices = null;
        if ('indices' in primitive) {
          let accessor = accessors[primitive.indices];
          elementCount = accessor.count;

          const bufferView = gltf.bufferViews[accessor.bufferView];
          bufferView.usage.add('index');

          indices = new PrimitiveIndices(
            bufferView,
            accessor.byteOffset,
            accessor.componentType
          );
        }

        primitives.push(new Primitive(
          attributeBuffers,
          indices,
          elementCount,
          primitive.mode,
          material
        ));
      }

      gltf.primitives.push(...primitives);
    }

    function processNode(node, worldMatrix) {
      let glNode = new Node();
      glNode.name = node.name;

      if ('mesh' in node) {
        glNode.primitives.push(...meshes[node.mesh]);
      }

      if (glNode.matrix) {
        glNode.localMatrix = mat4.clone(node.matrix);
      } else if (node.translation || node.rotation || node.scale) {
        glNode.localMatrix = mat4.create();
        mat4.fromRotationTranslationScale(
          glNode.localMatrix,
          node.rotation || DEFAULT_ROTATION,
          node.translation || DEFAULT_TRANSLATION,
          node.scale || DEFAULT_SCALE);
      }

      if (glNode.localMatrix) {
        mat4.mul(glNode.worldMatrix, worldMatrix, glNode.localMatrix);
      } else {
        mat4.copy(glNode.worldMatrix, worldMatrix);
      }

      if (node.children) {
        for (let nodeId of node.children) {
          glNode.children.push(processNode(json.nodes[nodeId], glNode.worldMatrix));
        }
      }

      return glNode;
    }

    let scene = json.scenes[json.scene];
    for (let nodeId of scene.nodes) {
      gltf.scene.children.push(processNode(json.nodes[nodeId], gltf.scene.worldMatrix));
    }

    await Promise.all(resourcePromises);

    return gltf;
  }
}

class Gltf2 {
  constructor() {
    this.buffers = [];
    this.bufferViews = [];
    this.images = [];
    this.samplers = [];
    this.textures = [];
    this.materials = [];
    this.primitives = [];
    this.scene = new Node();
  }
}

class Node {
  constructor() {
    this.name = null;
    this.children = [];
    this.primitives = [];
    this.worldMatrix = mat4.create();
    // null is treated as an identity matrix
    this.localMatrix = null;
  }
}

class PrimitiveBufferAttributes {
  constructor(bufferView) {
    this.bufferView = bufferView;
    this.minAttributeByteOffset = 0;
    this.attributeCount = 0;
    this.attributes = {};
  }

  addAttribute(name, primitiveAttribute) {
    if (this.attributeCount == 0) {
      this.minAttributeByteOffset = primitiveAttribute.byteOffset;
    } else {
      this.minAttributeByteOffset = Math.min(this.minAttributeByteOffset, primitiveAttribute.byteOffset);
    }

    this.attributeCount++;
    this.attributes[name] = primitiveAttribute;
  }
}

class PrimitiveAttribute {
  constructor(componentCount, componentType, byteOffset, normalized) {
    this.componentCount = componentCount || 3;
    this.componentType = componentType || GL.FLOAT;
    this.byteOffset = byteOffset || 0;
    this.normalized = normalized || false;
  }

  get packedByteStride() {
    return getComponentTypeSize(this.componentType) * this.componentCount;
  }

  get gpuFormat() {
    const count = this.componentCount > 1 ? `${this.componentCount}` : '';
    const norm = this.normalized ? 'norm' : '';

    switch(this.componentType) {
      case GL.BYTE:
        return `char${count}${norm}`;
      case GL.UNSIGNED_BYTE:
        return `uchar${count}${norm}`;
      case GL.SHORT:
        return `short${count}${norm}`;
      case GL.UNSIGNED_SHORT:
        return `ushort${count}${norm}`;
      case GL.UNSIGNED_INT:
        return `uint${count}`;
      case GL.FLOAT:
        return `float${count}`;
    }
  }
}

class PrimitiveIndices {
  constructor(bufferView, byteOffset, type) {
    this.bufferView = bufferView;
    this.byteOffset = byteOffset || 0;
    this.type = type || GL.UNSIGNED_SHORT;
  }

  get gpuType() {
    return this.type == GL.UNSIGNED_SHORT ? 'uint16' : 'uint32';
  }
}

class Primitive {
  constructor(attributeBuffers, indices, elementCount, mode, material) {
    this.attributeBuffers = attributeBuffers; // Map<BufferView -> PrimitiveBufferAttributes>
    this.indices = indices || null;
    this.elementCount = elementCount || 0;
    this.mode = mode || GL.TRIANGLES;
    this.material = material;

    this.enabledAttributes = new Set();
    for (let bufferAttributes of attributeBuffers.values()) {
      for (let attribName in bufferAttributes.attributes) {
        this.enabledAttributes.add(attribName);
      }
    }

    // For renderer-specific data;
    this.renderData = {};
  }

  getPartialRenderPipelineDescriptor(attributeMap) {
    const primitiveTopology = this.gpuPrimitiveTopology;
    const vertexState = this.getVertexStateDescriptor(attributeMap);

    const cullMode = this.material.primitiveTopologyprimitiveTopology ? 'back' : 'none';

    // Generate a key that describes this pipeline's layout/state
    let pipelineKey = `${primitiveTopology}|${cullMode}|${vertexState.hash}`;

    return {
      // Not used by WebGPU, but useful for identifing primitives with identical vertex states.
      hash: `${primitiveTopology}|${cullMode}|${vertexState.hash}`,

      primitiveTopology: this.gpuPrimitiveTopology,
      rasterizationState: {
        cullMode: this.material.cullFace ? 'back' : 'none'
      },
      vertexState,
    }
  }

  // Returns a GPUVertexStateDescriptor that describes the layout of the buffers for this primitive.
  getVertexStateDescriptor(attributeMap) {
    const vertexBuffers = [];

    for (let [bufferView, bufferAttributes] of this.attributeBuffers) {
      let arrayStride = bufferView.byteStride;

      const attributeLayouts = [];
      for (let attribName in bufferAttributes.attributes) {
        const attribute = bufferAttributes.attributes[attribName];
        // WebGPU doesn't allow attribute offsets greater than 2048.
        // This is apparently due to a Vulkan limitation.
        const offset = attribute.byteOffset - bufferAttributes.minAttributeByteOffset;
        const format = attribute.gpuFormat;

        attributeLayouts.push({
          shaderLocation: attributeMap[attribName],
          format,
          offset,
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

    const vertexState = {
      vertexBuffers,
    };

    if (this.mode == GL.TRIANGLE_STRIP || this.mode == GL.LINE_STRIP) {
      vertexState.indexFormat = this.indices.gpuType;
    }

    return vertexState;
  }

  get gpuPrimitiveTopology() {
    switch (this.mode) {
      case GL.TRIANGLES:
        return 'triangle-list';
      case GL.TRIANGLE_STRIP:
        return 'triangle-strip';
      case GL.LINES:
        return 'line-list';
      case GL.LINE_STRIP:
        return 'line-strip';
      case GL.POINTS:
        return 'point-list';
      default:
        // LINE_LOOP and TRIANGLE_FAN are unsupported.
        throw new Error('Unsupported primitive topology.');
    }
  }
}

class Sampler {
  constructor(magFilter, minFilter, wrapS, wrapT) {
    // WebGL-compatible definition
    this.magFilter = magFilter;
    this.minFilter = minFilter;
    this.wrapS = wrapS || GL.REPEAT;
    this.wrapT = wrapT || GL.REPEAT;

    // For renderer-specific data;
    this.renderData = {};
  }

  get gpuSamplerDescriptor() {
    // WebGPU-compatible definition
    const descriptor = {};

    if (!this.magFilter || this.magFilter == GL.LINEAR) {
      descriptor.magFilter = 'linear';
    }

    switch (this.minFilter) {
      case undefined:
        descriptor.minFilter = 'linear';
        descriptor.mipmapFilter = 'linear';
        break;
      case GL.LINEAR:
      case GL.LINEAR_MIPMAP_NEAREST:
        descriptor.minFilter = 'linear';
        break;
      case GL.NEAREST_MIPMAP_LINEAR:
        descriptor.mipmapFilter = 'linear';
        break;
      case GL.LINEAR_MIPMAP_LINEAR:
        descriptor.minFilter = 'linear';
        descriptor.mipmapFilter = 'linear';
        break;
    }

    switch (this.wrapS) {
      case GL.REPEAT:
        descriptor.addressModeU = 'repeat';
        break;
      case GL.MIRRORED_REPEAT:
        descriptor.addressModeU = 'mirror-repeat';
        break;
    }

    switch (this.wrapT) {
      case GL.REPEAT:
        descriptor.addressModeV = 'repeat';
        break;
      case GL.MIRRORED_REPEAT:
        descriptor.addressModeV = 'mirror-repeat';
        break;
    }

    return descriptor;
  }
}

class Texture {
  constructor(image, sampler) {
    this.image = image;
    this.sampler = sampler;

    // For renderer-specific data;
    this.renderData = {};
  }
}

class Material {
  constructor() {
    this.baseColorFactor = null;
    this.baseColorTexture = null;
    this.normalTexture = null;
    this.metallicRoughnessFactor = null;
    this.metallicRoughnessTexture = null;
    this.occlusionStrength = null;
    this.occlusionTexture = null;
    this.emissiveFactor = null;
    this.emissiveTexture = null;
    this.cullFace = true;
    this.blend = false;

    // For renderer-specific data;
    this.renderData = {};
  }
}

class BufferView {
  constructor(buffer, stride = 0, offset = 0, length = null) {
    this.buffer = buffer;
    this.byteStride = stride;
    this.byteOffset = offset;
    this.byteLength = length;
    this.dataView = buffer.then(value => new DataView(value, offset, length));

    this.usage = new Set();

    // For renderer-specific data;
    this.renderData = {};
  }
}
