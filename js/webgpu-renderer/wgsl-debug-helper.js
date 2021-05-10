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

const LOG_FULL_SHADER_TEXT = true;

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
    if (!this.pushErrorScope) {
      return origCreateShaderModule.call(this, descriptor);
    }

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

        const code = descriptor.code;
        for (const message of info.messages) {
          const type = message.type;

          // If the message doesn't have an associated position in the code just
          // repeat the message verbatim
          if (message.lineNum == 0 && message.linePos == 0) {
            MESSAGE_STYLE[type].logFn(message.message);
            continue;
          }

          const length = Math.max(message.length, 1);
          const lineStartIndex = code.lastIndexOf('\n', message.offset);
          const lineStart = code.substring(lineStartIndex+1, message.offset);
          const highlightText = code.substr(message.offset, length);
          const lineEndIndex = code.indexOf('\n', message.offset+length);
          const lineEnd = code.substring(message.offset+length, lineEndIndex == -1 ? undefined : lineEndIndex);

          MESSAGE_STYLE[type].logFn(
            `%c${message.lineNum}:${message.linePos} - %c${message.message}\n%c${lineStart}%c${highlightText}%c${lineEnd}`,
            'font-weight: bold;',
            'font-weight: default;',
            'color: green;',
            'color: lightgrey; background-color: darkred; font-weight: bold;',
            'color: green;');
        }

        if (validationError) {
          console.groupCollapsed("Validation Error Message");
          console.error(validationError.message);
          console.groupEnd();
        }

        if (LOG_FULL_SHADER_TEXT) {
          // Output the full shader text with numbered lines for easier reference.
          let numberedCodeLines = '';
          const codeLines = code.split('\n');
          const padLength = codeLines.length.toString().length;
          for (let i = 0; i < codeLines.length; ++i) {
            const lineNum = (i+1).toString().padStart(padLength, ' ');
            numberedCodeLines += `${lineNum}: ${codeLines[i]}\n`;
          }

          console.groupCollapsed("Full shader text");
          console.log(numberedCodeLines);
          console.groupEnd();
        }

        console.groupCollapsed("Stack Trace");
        console.trace();
        console.groupEnd();

        console.groupEnd();
      });
    }

    return shaderModule;
  }
}

// Template literal tag that offers several preprocessor improvements to WGSL
// shaders. For now it's just preprocessor #if/elif/else/endif statements.
const preprocessorSymbols = /#([a-z]*)\s*/gm
export function wgsl(strings, ...values) {
  let stateStack = [];
  let state = { string: '', elseIsValid: false, expression: true };
  let depth = 1;

  for (let i = 0; i < strings.length; ++i) {
    let string = strings[i];
    let lastIndex = 0;
    let valueConsumed = false;
    let matchedSymbols = string.matchAll(preprocessorSymbols);

    for (const match of matchedSymbols) {
      state.string += string.substring(lastIndex, match.index);
      switch (match[1]) {
        case 'if':
          if (match.index + match[0].length != string.length) {
            console.error('WGSL preprocessor error: #if must be immediately followed by a template expression (ie: ${value})');
            break;
          }
          valueConsumed = true;
          stateStack.push(state);
          depth++;
          state = { string: '', elseIsValid: true, expression: !!values[i] };
          break;
        case 'elif':
          if (match.index + match[0].length != string.length) {
            console.error('WGSL preprocessor error: #elif must be immediately followed by a template expression (ie: ${value})');
            break;
          } else if (!state.elseIsValid) {
            console.error('WGSL preprocessor error: #elif not preceeded by an #if or #elif');
            break;
          }
          valueConsumed = true;
          if (state.expression && stateStack.length != depth) {
            stateStack.push(state);
          }
          state = { string: '', elseIsValid: true, expression: !!values[i] };
          break;
        case 'else':
          if (!state.elseIsValid) {
            console.error('WGSL preprocessor error: #else not preceeded by an #if or #elif');
            break;
          }
          if (state.expression && stateStack.length != depth) {
            stateStack.push(state);
          }
          state = { string: '', elseIsValid: false, expression: true };
          break;
        case 'endif':
          const branchState = stateStack.length == depth ? stateStack.pop() : state;
          state = stateStack.pop();
          depth--;
          if (branchState.expression) {
            state.string += branchState.string;
          }
          break;
        default:
          // Unknown preprocessor symbol. Emit it back into the output string unchanged.
          state.string += match[0];
          break;
      }

      lastIndex = match.index + match[0].length;
    }

    // If the string didn't end on one of the preprocessor symbols append the rest of it here.
    if (lastIndex != string.length) {
      state.string += string.substring(lastIndex, string.length);
    }
    
    // If the next value wasn't consumed by the preprocessor symbol, append it here.
    if (!valueConsumed && values.length > i) {
      state.string += values[i];
    }
  }

  if (stateStack.length) {
    console.error('WGSL preprocessor error: Mismatch #if/#endif count');
  }

  return state.string;
}