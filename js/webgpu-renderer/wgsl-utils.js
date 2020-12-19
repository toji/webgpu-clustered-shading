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
 * A method that captures errors returned by compiling a WebGPU shader module and annotates them
 * with additional information before echoing to the console to aid with debugging.
 */
export function createShaderModuleDebug(device, code) {
  device.pushErrorScope('validation');

  const shaderModule = device.createShaderModule({ code });

  device.popErrorScope().then((error) => {
    if (error) {
      const codeLines = code.split('\n');

      // Find every line in the error that matches a known format. (line:char: message)
      const errorList = error.message.matchAll(SHADER_ERROR_REGEX);

      // Loop through the parsed error messages and show the relevant source code for each message.
      let errorMessage = '';
      let errorStyles = [];

      let lastIndex = 0;

      for (const errorMatch of errorList) {
        // Include out any content between the parsable lines
        if (errorMatch.index > lastIndex+1) {
          errorMessage += error.message.substring(lastIndex, errorMatch.index);
        }
        lastIndex = errorMatch.index + errorMatch[0].length;

        // Show the correlated line with an arrow that points at the indicated error position.
        const errorLine = parseInt(errorMatch[1], 10)-1;
        const errorChar = parseInt(errorMatch[2], 10);
        const errorPointer = '-'.repeat(errorChar-1) + '^';
        errorMessage += `${errorMatch[0]}\n%c${codeLines[errorLine]}\n%c${errorPointer}%c\n`;
        errorStyles.push(
          'color: grey;',
          'color: green; font-weight: bold;',
          'color: default;',
        );

      }

      // If no parsable errors were found, just print the whole message.
      if (lastIndex == 0) {
        console.error(error.message);
        return;
      }

      // Otherwise append any trailing message content.
      if (error.message.length > lastIndex+1) {
        errorMessage += error.message.substring(lastIndex+1, error.message.length);
      }

      // Finally, log to console as an error.
      console.error(errorMessage, ...errorStyles);
    }
  });

  return shaderModule;
}

// TODO: A simple preprocessor