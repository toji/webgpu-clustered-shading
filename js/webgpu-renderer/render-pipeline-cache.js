// Copyright 2021 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

let nextShaderModuleId = 1;
const shaderModuleIds = new WeakMap();
function getShaderModuleHashId(shaderModule) {
  if (!shaderModule) { return 0; }

  let id = shaderModuleIds.get(shaderModule);
  if (id == undefined) {
    id = nextShaderModuleId++;
    shaderModuleIds.set(shaderModule, id);
  }
  return id;
}

let nextPipelineLayoutId = 1;
const pipelineLayoutIds = new WeakMap();
function getPipelineLayoutHashId(pipelineLayout) {
  if (!pipelineLayout) { return 0; }

  let id = pipelineLayoutIds.get(pipelineLayout);
  if (id == undefined) {
    id = nextPipelineLayoutId++;
    pipelineLayoutIds.set(pipelineLayout, id);
  }
  return id;
}

const blendComponentDefaults = {
  srcFactor: "one",
  dstFactor: "zero",
  operation: "add",
};

const stencilStateFaceDefaults = {
  compare: "always",
  failOp: "keep",
  depthFailOp: "keep",
  passOp: "keep",
};

const renderPipelineDefaults = {
  layout: getPipelineLayoutHashId,

  vertex: {
    module: getShaderModuleHashId,
    entryPoint: undefined,
    buffers: [{
      arrayStride: undefined,
      stepMode: "vertex",
      attributes: {
        format: undefined,
        offset: undefined,
        shaderLocation: undefined,
      },
    }],
  },
  primitive: {
    topology: "triangle-list",
    stripIndexFormat: undefined,
    frontFace: "ccw",
    cullMode: "none",
  },
  depthStencil: {
    format: undefined,
    depthWriteEnabled: false,
    depthCompare: "always",
    stencilFront: stencilStateFaceDefaults,
    stencilBack: stencilStateFaceDefaults,
    stencilReadMask: 0xFFFFFFFF,
    stencilWriteMask: 0xFFFFFFFF,
    depthBias: 0,
    depthBiasSlopeScale: 0,
    depthBiasClamp: 0,
  },
  multisample: {
    count: 1,
    mask: 0xFFFFFFFF,
    alphaToCoverageEnabled: false,
  },
  fragment: {
    module: getShaderModuleHashId,
    entryPoint: undefined,
    targets: [{
      format: undefined,
      blend: {
        color: blendComponentDefaults,
        alpha: blendComponentDefaults,
      },
      writeMask: 0xF,
    }]
  },
};

// Ensures that keys are always written in the same order and that default values are always ommitted.
function normalizeDescriptor(descriptor, defaults) {
  if (descriptor == undefined) {
    return undefined;
  }

  const normalized = {};
  let writtenKeys = 0;

  for (let key in defaults) {
    let defaultValue = defaults[key];
    let value = descriptor[key];

    if (typeof defaultValue == 'function') {
      value = defaultValue(value);
    } else if (defaultValue instanceof Array) {
      if (value) {
        let arrayValue = [];
        const elementDefault = defaultValue[0];
        for (let element of value) {
          if (typeof elementDefault == 'Function') {
            element = elementDefault(element);
          } else if (typeof elementDefault == 'Object') {
            element = normalizeDescriptor(element, elementDefault);
          } else if (value == elementDefault) {
            throw new Error('Invalid default for descriptor array');
          }
          arrayValue.push(element);
        }
        if (arrayValue.length == 0) {
          arrayValue = undefined;
        }
        value = arrayValue;
      }
    } else if (typeof defaultValue == 'object') {
      value = normalizeDescriptor(value, defaultValue);
    }  else if (value == defaultValue) {
      continue;
    }

    if (value != undefined) {
      normalized[key] = value;
      writtenKeys++;
    }
  }

  if (writtenKeys == 0) {
    return undefined;
  }

  return normalized;
}

// Borrowed from https://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
function stringToHash(str){
  let hash = 0;
  if (str.length == 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash<<5)-hash)+char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

// Generates a unique (and lengthy) string that identifies this pipeline. This could definitely stand to be more
// efficient, but does the job for now.
function getRenderPipelineDescriptorHash(descriptor) {
  const normalized = normalizeDescriptor(descriptor, renderPipelineDefaults);
  const normalizedString = JSON.stringify(normalized);
  return stringToHash(normalizedString);
}

// Creates a cache of GPUPipline objects that helps prevents duplicate pipelines for being created for compatible
// pipeline descriptors.
export class RenderPipelineCache {
  constructor(device) {
    this.device = device;

    this.renderPipelines = new Map();
  }

  getRenderPipeline(descriptor) {
    const hash = getRenderPipelineDescriptorHash(descriptor);
    let pipeline = this.renderPipelines.get(hash);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline(descriptor);
      this.renderPipelines.set(hash, pipeline);
      // TODO: Just for debugging, remove later.
      pipeline.renderPipelineCacheHash = hash;
    }
    return pipeline;
  }
}