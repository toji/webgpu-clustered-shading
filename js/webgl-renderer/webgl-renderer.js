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
import { ShaderProgram } from './shader-program.js';
import { WEBGL_VERTEX_SOURCE, WEBGL_FRAGMENT_SOURCE, ATTRIB_MAP, SAMPLER_MAP, GetDefinesForPrimitive } from '../pbr-shader.js';

export class PBRShaderProgram extends ShaderProgram {
  constructor(gl, defines) {
    super(gl, {
      vertexSource: WEBGL_VERTEX_SOURCE(defines),
      fragmentSource: WEBGL_FRAGMENT_SOURCE(defines),
      attributeLocations: ATTRIB_MAP
    });

    this.opaqueMaterials = new Map(); // Material -> Primitives
    this.blendedMaterials = new Map(); // Material -> Primitives
  }
}

function isPowerOfTwo(n) {
  return (n & (n - 1)) === 0;
}

const LightSprite = {
  vertexCount: 6,
  vertexArray: new Float32Array([
  // x   y
    -1, -1,
    -1,  1,
     1,  1,

     1,  1,
     1, -1,
    -1, -1,
  ]),
  vertexSource: `
  attribute vec2 POSITION;

  const float lightSize = 0.2;

  uniform mat4 projectionMatrix;
  uniform mat4 viewMatrix;

  uniform vec3 lightPosition;

  varying vec2 vPos;

  void main() {
    vPos = POSITION;
    vec3 worldPos = vec3(POSITION, 0.0) * lightSize;

    // Generate a billboarded model view matrix
    mat4 bbModelViewMatrix = mat4(1.0);
    bbModelViewMatrix[3] = vec4(lightPosition, 1.0);

    bbModelViewMatrix = viewMatrix * bbModelViewMatrix;
    bbModelViewMatrix[0][0] = 1.0;
    bbModelViewMatrix[0][1] = 0.0;
    bbModelViewMatrix[0][2] = 0.0;

    bbModelViewMatrix[1][0] = 0.0;
    bbModelViewMatrix[1][1] = 1.0;
    bbModelViewMatrix[1][2] = 0.0;

    bbModelViewMatrix[2][0] = 0.0;
    bbModelViewMatrix[2][1] = 0.0;
    bbModelViewMatrix[2][2] = 1.0;

    gl_Position = projectionMatrix * bbModelViewMatrix * vec4(worldPos, 1.0);
  }`,
  fragmentSource: `
  precision highp float;

  uniform vec3 lightColor;

  varying vec2 vPos;

  void main() {
    float distToCenter = length(vPos);
    float fade = (1.0 - distToCenter) * (1.0 / (distToCenter * distToCenter));
    gl_FragColor = vec4(lightColor * fade, fade);
  }`
};

export class WebGLRenderer extends Renderer {
  constructor() {
    super();

    const gl = this.gl = this.canvas.getContext('webgl');
    gl.clearColor(0.5, 0.0, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.programs = new Map();

    this.buildLightSprite();
  }

  buildLightSprite() {
    const gl = this.gl;
    this.lightBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, LightSprite.vertexArray, gl.STATIC_DRAW);

    this.lightProgram = new ShaderProgram(gl, {
      vertexSource: LightSprite.vertexSource,
      fragmentSource: LightSprite.fragmentSource,
      attributeLocations: ATTRIB_MAP
    });
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

    //await texture.image.decode();
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
    const defines = GetDefinesForPrimitive(primitive);
    defines.LIGHT_COUNT = this.lightCount;
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

      // Once the program is linked we can set the sampler indices once and
      // they'll apply for the lifetime of the program.
      program.use();
      for (let samplerName in SAMPLER_MAP) {
        if (program.uniform[samplerName]) {
          this.gl.uniform1i(program.uniform[samplerName], SAMPLER_MAP[samplerName]);
        }
      }
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
    gl.disable(gl.BLEND);
    for (let program of this.programs.values()) {
      if (program.opaqueMaterials.size) {
        this.drawRenderTree(program, program.opaqueMaterials);
      }
    }

    // Blended primitives next
    gl.enable(gl.BLEND);
    for (let program of this.programs.values()) {
      if (program.blendedMaterials.size) {
        this.drawRenderTree(program, program.blendedMaterials);
      }
    }

    // Last, render a sprite for all of the lights
    this.lightProgram.use();
    gl.uniformMatrix4fv(this.lightProgram.uniform.projectionMatrix, false, this.projectionMatrix);
    gl.uniformMatrix4fv(this.lightProgram.uniform.viewMatrix, false, this.viewMatrix);

    gl.enableVertexAttribArray(ATTRIB_MAP.POSITION);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuffer);
    gl.vertexAttribPointer(ATTRIB_MAP.POSITION, 2, gl.FLOAT, false, 8, 0);
    for (let i = 0; i < this.lightCount; ++i) {
      const light = this.lights[i];
      if (light.attenuation == 0) { continue; }
      gl.uniform3fv(this.lightProgram.uniform.lightPosition, light.position);
      gl.uniform3fv(this.lightProgram.uniform.lightColor, light.color);

      gl.drawArrays(gl.TRIANGLES, 0, LightSprite.vertexCount);
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

    for (let attribName in ATTRIB_MAP) {
      if(!primitive.enabledAttributes.has(attribName)) {
        gl.disableVertexAttribArray(ATTRIB_MAP[attribName]);
      }
    }
  }

  bindMaterial(program, material) {
    const gl = this.gl;
    const uniform = program.uniform;

    if (material.cullFace) {
      gl.enable(gl.CULL_FACE);
    } else {
      gl.disable(gl.CULL_FACE);
    }

    gl.uniform4fv(uniform.baseColorFactor, material.baseColorFactor);
    gl.uniform2fv(uniform.metallicRoughnessFactor, material.metallicRoughnessFactor);
    gl.uniform3fv(uniform.emissiveFactor, material.emissiveFactor);

    if (material.baseColorTexture) {
      gl.activeTexture(gl.TEXTURE0 + SAMPLER_MAP.baseColorTexture);
      gl.bindTexture(gl.TEXTURE_2D, material.baseColorTexture.renderData.glTexture);
    }

    if (material.normalTexture) {
      gl.activeTexture(gl.TEXTURE0 + SAMPLER_MAP.normalTexture);
      gl.bindTexture(gl.TEXTURE_2D, material.normalTexture.renderData.glTexture);
    }

    if (material.metallicRoughnessTexture) {
      gl.activeTexture(gl.TEXTURE0 + SAMPLER_MAP.metallicRoughnessTexture);
      gl.bindTexture(gl.TEXTURE_2D, material.metallicRoughnessTexture.renderData.glTexture);
    }

    if (material.occlusionTexture) {
      gl.activeTexture(gl.TEXTURE0 + SAMPLER_MAP.occlusionTexture);
      gl.bindTexture(gl.TEXTURE_2D, material.occlusionTexture.renderData.glTexture);

      gl.uniform1f(uniform.occlusionStrength, material.occlusionStrength);
    }

    if (material.emissiveTexture) {
      gl.activeTexture(gl.TEXTURE0 + SAMPLER_MAP.emissiveTexture);
      gl.bindTexture(gl.TEXTURE_2D, material.emissiveTexture.renderData.glTexture);
    }
  }

  drawRenderTree(program, materialList) {
    const gl = this.gl;

    program.use();

    gl.uniformMatrix4fv(program.uniform.projectionMatrix, false, this.projectionMatrix);
    gl.uniformMatrix4fv(program.uniform.viewMatrix, false, this.viewMatrix);
    gl.uniform3fv(program.uniform.cameraPosition, this.cameraPosition);

    for (let i = 0; i < this.lightCount; ++i) {
      let light = this.lights[i];
      gl.uniform3fv(program.uniform[`lights[${i}].position`], light.position);
      gl.uniform3fv(program.uniform[`lights[${i}].color`], light.color);
      gl.uniform1f(program.uniform[`lights[${i}].attenuation`], light.attenuation);
    }

    gl.uniform1f(program.uniform.lightAmbient, this.lightAmbient[0]);

    for (let [material, primitives] of materialList) {
      this.bindMaterial(program, material);

      for (let primitive of primitives) {
        this.bindPrimitive(primitive);

        for (let worldMatrix of primitive.renderData.instances) {
          gl.uniformMatrix4fv(program.uniform.modelMatrix, false, worldMatrix);

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