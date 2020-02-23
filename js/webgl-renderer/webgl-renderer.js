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
import { PBRShaderProgram } from './pbr-material.js';

function isPowerOfTwo(n) {
  return (n & (n - 1)) === 0;
}

export class WebGLRenderer extends GltfRenderer {
  constructor() {
    super();

    const gl = this.gl = this.canvas.getContext('webgl');
    gl.clearColor(0.5, 0.0, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.programs = new Map();

    this.lightDirection = new Float32Array([-0.5, -1.0, -0.25]);
    this.lightColor = new Float32Array([0.6, 0.6, 0.5]);
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
      if (bufferView.usage.indexOf('vertex') != -1) {
        resourcePromises.push(this.initGLBuffer(bufferView, gl.ARRAY_BUFFER));
      } else if (bufferView.usage.indexOf('index') != -1) {
        resourcePromises.push(this.initGLBuffer(bufferView, gl.ELEMENT_ARRAY_BUFFER));
      }
    }

    for (let texture of gltf.textures) {
      resourcePromises.push(this.initTexture(texture));
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

  async initTexture(texture) {
    const gl = this.gl;
    const glTexture = gl.createTexture();
    texture.renderData.glTexture = glTexture;

    const imgBitmap = await createImageBitmap(texture.image);
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgBitmap);

    const sampler = texture.sampler;
    const mipmap = isPowerOfTwo(imgBitmap.width) && isPowerOfTwo(imgBitmap.height);
    if (mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    const minFilter = sampler.minFilter || (mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    const wrapS = sampler.wrapS || (mipmap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    const wrapT = sampler.wrapT || (mipmap ? gl.REPEAT : gl.CLAMP_TO_EDGE);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampler.magFilter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  }

  initPrimitive(primitive) {
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

  onFrame(timestamp) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

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

    gl.uniformMatrix4fv(program.uniform.PROJECTION_MATRIX, false, this.projectionMatrix);
    gl.uniform3fv(program.uniform.LIGHT_DIRECTION, this.lightDirection);
    gl.uniform3fv(program.uniform.LIGHT_COLOR, this.lightColor);

    gl.uniformMatrix4fv(program.uniform.VIEW_MATRIX, false, this.camera.viewMatrix);
    gl.uniform3fv(program.uniform.CAMERA_POSITION, this.camera.position);

    for (let [material, primitives] of materialList) {
      program.bindMaterial(material);

      if (material.cullFace) {
        gl.enable(gl.CULL_FACE);
      } else {
        gl.disable(gl.CULL_FACE);
      }

      for (let primitive of primitives) {
        program.bindPrimitive(primitive);

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
  }
}