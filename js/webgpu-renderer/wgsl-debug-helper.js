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

const MESSAGE_STYLE = {
  'info': {
    icon: 'ℹ️',
    logFn: console.info,
  },
  'warning': {
    icon: '⚠️',
    logFn: console.warn,
  },
  'error': {
    icon: '⛔',
    logFn: console.error,
  }
}

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

    const validationPromise = this.popErrorScope().then((error) => {
      // If compilationInfo is not available in this browser just echo any error
      // messages we get.
      if (!shaderModule.compilationInfo && error) {
        console.error(error.message);
      } else {
        return error;
      }
    });

    if (shaderModule.compilationInfo) {
      shaderModule.compilationInfo().then(async (info) => {
        const validationError = await validationPromise;

        if (!info.messages.length && !validationError) {
          return;
        }

        const codeLines = descriptor.code.split('\n');

        const messageCount = {
          error: 0,
          warning: 0,
          info: 0,
        };

        for (const message of info.messages) {
          messageCount[message.type] += 1;
        }

        if (messageCount.error == 0 && validationError) {
          messageCount.error = 1;
        }

        const label = shaderModule.label;
        let groupLabel = (label ? `"${label}"` : 'Shader') +
            ' returned compilation messages:';
        for (const type in messageCount) {
          if (messageCount[type] > 0) {
            groupLabel += ` ${messageCount[type]}${MESSAGE_STYLE[type].icon}`;
          }
        }

        if (messageCount.error == 0) {
          console.groupCollapsed(groupLabel);
        } else {
          console.group(groupLabel);
        }
        for (const message of info.messages) {
          const type = message.type;
          const msgPointer = '-'.repeat(Math.max(message.linePos-1, 0)) + '^';

          MESSAGE_STYLE[type].logFn(
            `%c${message.lineNum}:${message.linePos} - %c${message.message}\n%c${codeLines[Math.max(message.lineNum-1, 0)]}\n%c${msgPointer}`,
            'font-weight: bold;',
            'font-weight: default;',
            'color: green;',
            'color: grey;');
        }

        if (validationError) {
          console.groupCollapsed("Validation Error Message");
          console.error(validationError.message);
          console.groupEnd();
        }

        console.groupCollapsed("Full shader text");
        console.log(descriptor.code);
        console.groupEnd();

        console.groupCollapsed("Stack Trace");
        console.trace();
        console.groupEnd();

        console.groupEnd();
      });
    }

    return shaderModule;
  }
}
