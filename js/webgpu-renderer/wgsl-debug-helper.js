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

const SHADER_ERROR_REGEX = /([0-9]*):([0-9*]*): (.*)$/gm;

/**
 * A method that captures errors returned by compiling a WebGPU shader module
 * and annotates them with additional information before echoing to the console
 * to aid with debugging.
 */
if ('GPUDevice' in window) {
  const origCreateShaderModule = GPUDevice.prototype.createShaderModule;
  GPUDevice.prototype.createShaderModule = function(descriptor) {
    this.pushErrorScope('validation');

    const shaderModule = origCreateShaderModule.call(this, descriptor);

    this.popErrorScope().then((error) => {
      // If compilationInfo is not available in this browser just echo any error
      // messages we get.It's expected that the error message should cover a
      // subset of any compilationInfo messages.
      if (!shaderModule.compilationInfo && error) {
        console.error(error.message);
      }
    });

    if (shaderModule.compilationInfo) {
      shaderModule.compilationInfo().then((info) => {
        if (!info.messages.length) {
          return;
        }

        const codeLines = descriptor.code.split('\n');

        let infoCount = 0;
        let warnCount = 0;
        let errorCount = 0;

        for (const message of info.messages) {
          switch (message.type) {
            case 'info': infoCount++; break;
            case 'warning': warnCount++; break;
            case 'error': errorCount++; break;
          }
        }

        const label = shaderModule.label;
        let groupLabel = (label ? `"${label}"` : 'Shader') +
            ' returned compilation messages:';
        if (errorCount) {
          groupLabel += ` ${errorCount}⛔`;
        }
        if (warnCount) {
          groupLabel += ` ${warnCount}⚠`;
        }
        if (infoCount) {
          groupLabel += ` ${infoCount}ℹ`;
        }

        if (errorCount == 0) {
          console.groupCollapsed(groupLabel);
        } else {
          console.group(groupLabel);
        }
        for (const message of info.messages) {
          const msgPointer = '-'.repeat(Math.max(message.linePos-1, 0)) + '^';
          
          let consoleFn;
          switch (message.type) {
            case 'info': consoleFn = console.info; break;
            case 'warning': consoleFn = console.warn; break;
            case 'error': consoleFn = console.error; break;
          }

          consoleFn(`%c${message.lineNum}:${message.linePos} - %c${message.message}\n%c${codeLines[Math.max(message.lineNum-1, 0)]}\n%c${msgPointer}`,
            'font-weight: bold;',
            'font-weight: default;',
            'color: green;',
            'color: grey;');
        }
        console.groupCollapsed("Full shader text");
        console.log(descriptor.code);
        console.groupEnd();
        console.groupEnd();
      });
    }

    return shaderModule;
  }
}

// TODO: A simple preprocessor