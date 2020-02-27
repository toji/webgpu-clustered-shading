// Copyright 2018 The Immersive Web Community Group
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

// Just a helper class to easily compile and link a shader program, then query
// some helpful values such as attribute and uniform locations.
export class ShaderProgram {
  constructor(gl, config) {
    if (!config || !config.vertexSource || !config.fragmentSource) {
      throw new Error('Must provide a vertexSource and fragmentSource');
    }

    this.gl = gl;
    this.program = gl.createProgram();
    this.attribute = {};
    this.uniform = {};
    this.uniformBlock = {};

    const vertShader = gl.createShader(gl.VERTEX_SHADER);
    gl.attachShader(this.program, vertShader);
    gl.shaderSource(vertShader, config.vertexSource);
    gl.compileShader(vertShader);

    const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.attachShader(this.program, fragShader);
    gl.shaderSource(fragShader, config.fragmentSource);
    gl.compileShader(fragShader);

    if (config.attributeLocations) {
      for (let attribName in config.attributeLocations) {
        gl.bindAttribLocation(this.program, config.attributeLocations[attribName], attribName);
        this.attribute[attribName] = config.attributeLocations[attribName];
      }
    }

    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
        console.error('Vertex shader compile error: ' + gl.getShaderInfoLog(vertShader));
      } else if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        console.error('Fragment shader compile error: ' + gl.getShaderInfoLog(fragShader));
      } else {
        console.error('Program link error: ' + gl.getProgramInfoLog(this.program));
      }
      gl.deleteProgram(this.program);
      this.program = null;
      return;
    }

    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);

    if (!config.attributeLocations) {
      let attribCount = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < attribCount; i++) {
        let attribInfo = gl.getActiveAttrib(this.program, i);
        this.attribute[attribInfo.name] = gl.getAttribLocation(this.program, attribInfo.name);
      }
    }

    let uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    let uniformName = '';
    for (let i = 0; i < uniformCount; i++) {
      let uniformInfo = gl.getActiveUniform(this.program, i);
      uniformName = uniformInfo.name;
      this.uniform[uniformName] = gl.getUniformLocation(this.program, uniformName);
    }

    // Are we using WebGL 2?
    if (gl.ACTIVE_UNIFORM_BLOCKS) {
      let uniformBlockCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORM_BLOCKS);
      for (let i = 0; i < uniformBlockCount; i++) {
        let uniformBlockName = gl.getActiveUniformBlockName(this.program, i);
        this.uniformBlock[uniformBlockName] = i;
      }
    }
  }

  use() {
    this.gl.useProgram(this.program);
  }
}
