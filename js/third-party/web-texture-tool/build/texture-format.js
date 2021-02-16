// For access to WebGL enums without a context.
const GL = WebGLRenderingContext;

/**
 * Texture Format
 *
 * @typedef {string} WebTextureFormat
 */

// Additional format data used by Web Texture Tool, based off WebGPU formats.
// WebGL equivalents given where possible.
export const WebTextureFormat = {
  // Uncompressed formats
  'rgb8unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGB, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8051}, // RGB8
  },
  'rgba8unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8058}, // RGBA8
  },
  'rgb8unorm-srgb': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGB, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8C40}, // SRGB8
  },
  'rgba8unorm-srgb': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8C43}, // SRGB8_ALPHA8
  },
  'rgb565unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGB, type: GL.UNSIGNED_SHORT_5_6_5, sizedFormat: GL.RGB565},
  },
  'rgba4unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_SHORT_4_4_4_4, sizedFormat: GL.RGBA4},
  },
  'rgba5551unorm': {
    canGenerateMipmaps: true,
    gl: {format: GL.RGBA, type: GL.UNSIGNED_SHORT_5_5_5_1, sizedFormat: GL.RGB5_A1},
  },

  'bgra8unorm': {canGenerateMipmaps: true}, // No WebGL equivalent
  'bgra8unorm-srgb': {canGenerateMipmaps: true}, // No WebGL equivalent

  // Compressed formats
  // WebGL enums from http://www.khronos.org/registry/webgl/extensions/
  'bc1-rgb-unorm': {
    gl: {texStorage: true, sizedFormat: 0x83F0}, // COMPRESSED_RGB_S3TC_DXT1_EXT
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
  'bc2-rgba-unorm': {
    gl: {texStorage: true, sizedFormat: 0x83F2}, // COMPRESSED_RGBA_S3TC_DXT3_EXT
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'bc3-rgba-unorm': {
    gl: {texStorage: false, sizedFormat: 0x83F3}, // COMPRESSED_RGBA_S3TC_DXT5_EXT
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'bc7-rgba-unorm': {
    gl: {texStorage: true, sizedFormat: 0x8E8C}, // COMPRESSED_RGBA_BPTC_UNORM_EXT
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'etc1-rgb-unorm': {
    gl: {texStorage: false, sizedFormat: 0x8D64}, // COMPRESSED_RGB_ETC1_WEBGL
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
  'etc2-rgba8unorm': {
    gl: {texStorage: true, sizedFormat: 0x9278}, // COMPRESSED_RGBA8_ETC2_EAC
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'astc-4x4-rgba-unorm': {
    gl: {texStorage: true, sizedFormat: 0x93B0}, // COMPRESSED_RGBA_ASTC_4x4_KHR
    compressed: {blockBytes: 16, blockWidth: 4, blockHeight: 4},
  },
  'pvrtc1-4bpp-rgb-unorm': {
    gl: {texStorage: false, sizedFormat: 0x8C00}, // COMPRESSED_RGB_PVRTC_4BPPV1_IMG
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
  'pvrtc1-4bpp-rgba-unorm': {
    gl: {texStorage: false, sizedFormat: 0x8C02}, // COMPRESSED_RGBA_PVRTC_4BPPV1_IMG
    compressed: {blockBytes: 8, blockWidth: 4, blockHeight: 4},
  },
};
