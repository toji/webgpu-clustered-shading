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
import { PBRShaderProgram, ATTRIB_MAP, UNIFORM_BLOCKS } from './pbr-material.js';
import { vec3, mat4 } from '../third-party/gl-matrix/src/gl-matrix.js';

function isPowerOfTwo(n) {
  return (n & (n - 1)) === 0;
}

export class WebGL2Renderer extends GltfRenderer {
  constructor() {
    super();

    const gl = this.gl = this.canvas.getContext('webgl2');
    gl.clearColor(0.0, 0.5, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.programs = new Map();

    this.frameUniforms = new Float32Array(16 + 16 + 4 + 4 + 4);

    this.projectionMatrix = new Float32Array(this.frameUniforms.buffer, 0, 16);
    this.viewMatrix = new Float32Array(this.frameUniforms.buffer, 16 * 4, 16);
    this.cameraPosition = new Float32Array(this.frameUniforms.buffer, 32 * 4, 3);
    this.lightDirection = new Float32Array(this.frameUniforms.buffer, 36 * 4, 3);
    this.lightColor = new Float32Array(this.frameUniforms.buffer, 40 * 4, 3);

    vec3.set(this.lightDirection, -0.5, -1.0, -0.25);
    vec3.set(this.lightColor, 0.6, 0.6, 0.5);

    this.frameUniformBuffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.frameUniformBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.frameUniforms, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, UNIFORM_BLOCKS.FrameUniforms, this.frameUniformBuffer);
  }

  init() {

  }

  onResize(width, height) {
    this.gl.viewport(0, 0, width, height);
  }

  setGltf(gltf) {
    const gl = this.gl;
    const resourcePromises = [];

    for (let bufferView of gltf.bufferViews) {
      if (bufferView.usage.has('vertex')) {
        resourcePromises.push(this.initGLBuffer(bufferView, gl.ARRAY_BUFFER));
      } else if (bufferView.usage.has('index')) {
        resourcePromises.push(this.initGLBuffer(bufferView, gl.ELEMENT_ARRAY_BUFFER));
      }
    }

    for (let image of gltf.images) {
      resourcePromises.push(this.initImage(image));
    }

    for (let sampler of gltf.samplers) {
      this.initSampler(sampler);
    }

    for (let primitive of gltf.primitives) {
      this.initPrimitive(primitive);
    }

    this.initNode(gltf.scene);

    return Promise.all(resourcePromises);
  }

  async initGLBuffer(bufferView, target) {
    const gl = this.gl;
    const glBuffer = gl.createBuffer();
    bufferView.renderData.glBuffer = glBuffer;

    const bufferData = await bufferView.dataView;
    gl.bindBuffer(target, glBuffer);
    gl.bufferData(target, bufferData, gl.STATIC_DRAW);
  }

  async initImage(image) {
    const gl = this.gl;
    const glTexture = gl.createTexture();
    image.glTexture = glTexture;

    //await image.decode();
    const imgBitmap = await createImageBitmap(image);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgBitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  initSampler(sampler) {
    const gl = this.gl;
    const glSampler = gl.createSampler();
    sampler.renderData.glSampler = glSampler;

    const minFilter = sampler.minFilter || gl.LINEAR_MIPMAP_LINEAR;
    const wrapS = sampler.wrapS || gl.REPEAT;
    const wrapT = sampler.wrapT || gl.REPEAT;

    gl.samplerParameteri(glSampler, gl.TEXTURE_MAG_FILTER, sampler.magFilter || gl.LINEAR);
    gl.samplerParameteri(glSampler, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_S, wrapS);
    gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_T, wrapT);
  }

  initPrimitive(primitive) {
    const gl = this.gl;
    const defines = PBRShaderProgram.getProgramDefines(primitive);
    const material = primitive.material;

    primitive.renderData.instances = [];

    let key = '';
    for (let define in defines) {
      key += `${define}=${defines[define]},`;
    }

    let program = this.programs.get(key);
    if (!program) {
      program = new PBRShaderProgram(this.gl, defines);
      this.programs.set(key, program);
    }

    const glVertexArray = gl.createVertexArray();
    gl.bindVertexArray(glVertexArray);
    this.bindPrimitive(primitive); // Populates the vertex buffer bindings for the VertexArray
    gl.bindVertexArray(null);
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
    primitiveList.push(primitive);
  }

  initNode(node) {
    for (let primitive of node.primitives) {
      primitive.renderData.instances.push(node.worldMatrix);
    }

    for (let childNode of node.children) {
      this.initNode(childNode);
    }
  }

  bindPrimitive(primitive) {
    const gl = this.gl;

    for (let [bufferView, attributes] of primitive.attributeBuffers) {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferView.renderData.glBuffer);

      for (let attribName in attributes) {
        const attribute = attributes[attribName];
        const attribIndex = ATTRIB_MAP[attribName];
        gl.enableVertexAttribArray(attribIndex);
        gl.vertexAttribPointer(
          attribIndex, attribute.componentCount, attribute.componentType,
          attribute.normalized, bufferView.byteStride, attribute.byteOffset);
      }
    }

    if (primitive.indices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indices.bufferView.renderData.glBuffer);
    }
  }

  onFrame(timestamp) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    mat4.copy(this.viewMatrix, this.camera.viewMatrix);
    vec3.copy(this.cameraPosition, this.camera.position);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.frameUniformBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.frameUniforms, gl.DYNAMIC_DRAW);

    // Loop through the render tree to bind and render every primitive instance

    // Opaque primitives first
    for (let program of this.programs.values()) {
      if (program.opaqueMaterials.size) {
        gl.disable(gl.BLEND);
        this.drawRenderTree(program, program.opaqueMaterials);
      }
    }

    // Blended primitives next
    for (let program of this.programs.values()) {
      if (program.blendedMaterials.size) {
        gl.enable(gl.BLEND);
        this.drawRenderTree(program, program.blendedMaterials);
      }
    }
  }

  drawRenderTree(program, materialList) {
    const gl = this.gl;

    program.use();

    for (let [material, primitives] of materialList) {
      program.bindMaterial(material);

      if (material.cullFace) {
        gl.enable(gl.CULL_FACE);
      } else {
        gl.disable(gl.CULL_FACE);
      }

      for (let primitive of primitives) {
        gl.bindVertexArray(primitive.renderData.glVertexArray);

        for (let worldMatrix of primitive.renderData.instances) {
          gl.uniformMatrix4fv(program.uniform.MODEL_MATRIX, false, worldMatrix);

          // Draw primitive
          if (primitive.indices) {
            gl.drawElements(primitive.mode, primitive.elementCount,
              primitive.indices.type, primitive.indices.byteOffset);
          } else {
            gl.drawArrays(primitive.mode, 0, primitive.elementCount);
          }
        }
      }
    }
    gl.bindVertexArray(null);
  }
}