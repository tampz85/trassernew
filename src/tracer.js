const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

const SUPPORTED_SIGNATURES = [
  { format: 'png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: 'jpeg', signature: [0xff, 0xd8, 0xff] },
  { format: 'bmp', signature: [0x42, 0x4d] }
];

function asBuffer(inputBuffer) {
  if (Buffer.isBuffer(inputBuffer)) return inputBuffer;
  if (inputBuffer instanceof Uint8Array) {
    return Buffer.from(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength);
  }
  if (inputBuffer instanceof ArrayBuffer) return Buffer.from(inputBuffer);
  throw new TypeError('Input image must be a Buffer, Uint8Array, or ArrayBuffer');
}

function detectFormat(buffer) {
  for (const supported of SUPPORTED_SIGNATURES) {
    if (buffer.length >= supported.signature.length &&
        supported.signature.every((byte, index) => buffer[index] === byte)) {
      return supported.format;
    }
  }
  return null;
}

function finiteOption(value, name, minimum, maximum) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || (maximum !== undefined && number > maximum)) {
    throw new RangeError(`${name} must be between ${minimum}${maximum === undefined ? '' : ` and ${maximum}`}`);
  }
  return number;
}

function parseColor(color, index) {
  if (typeof color === 'string') {
    const hex = color.trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 255
      };
    }
    if (/^[0-9a-f]{8}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16)
      };
    }
    throw new Error(`Invalid palette color at index ${index}: ${color}`);
  }

  if (!color || typeof color !== 'object') {
    throw new Error(`Invalid palette color at index ${index}`);
  }
  const result = {
    r: Number(color.r),
    g: Number(color.g),
    b: Number(color.b),
    a: color.a === undefined ? 255 : Number(color.a)
  };
  if (!Object.values(result).every(Number.isFinite) ||
      result.r < 0 || result.r > 255 || result.g < 0 || result.g > 255 ||
      result.b < 0 || result.b > 255 || result.a < 0 || result.a > 255) {
    throw new Error(`Invalid palette color at index ${index}`);
  }
  return result;
}

function normalizeOptions(options = {}) {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('Tracing options must be an object');
  }

  const normalized = { ...options };
  normalized.threshold = finiteOption(options.threshold, 'threshold', 0, 255);
  normalized.blur = finiteOption(options.blur, 'blur', 0, 1000);
  normalized.minArea = finiteOption(options.minArea, 'minArea', 0, Number.MAX_SAFE_INTEGER);
  normalized.ltres = finiteOption(options.ltres, 'ltres', 0, Number.MAX_SAFE_INTEGER);
  normalized.qtres = finiteOption(options.qtres, 'qtres', 0, Number.MAX_SAFE_INTEGER);
  normalized.pathomit = finiteOption(options.pathomit, 'pathomit', 0, Number.MAX_SAFE_INTEGER);
  normalized.strokewidth = finiteOption(options.strokewidth, 'strokewidth', 0, Number.MAX_SAFE_INTEGER);
  normalized.scale = finiteOption(options.scale, 'scale', 0, Number.MAX_SAFE_INTEGER);
  normalized.roundcoords = finiteOption(options.roundcoords, 'roundcoords', -1, 20);

  if (options.palette !== undefined) {
    if (!Array.isArray(options.palette) || options.palette.length === 0) {
      throw new TypeError('palette must be a non-empty array');
    }
    normalized.palette = options.palette.map(parseColor);
  } else {
    normalized.palette = undefined;
  }
  return normalized;
}

function traceImage(inputBuffer, options = {}) {
  const buffer = asBuffer(inputBuffer);
  if (buffer.length === 0) throw new Error('Input image buffer is empty');
  const format = detectFormat(buffer);
  if (!format) throw new Error(`Unsupported image format; expected PNG, JPG, or BMP`);

  const normalizedOptions = normalizeOptions(options);
  const status = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-tracer-'));
  const resultPath = path.join(workDirectory, 'result.txt');
  let worker;

  try {
    worker = new Worker(path.join(__dirname, 'tracer-worker.js'), {
      workerData: {
        inputBuffer: buffer,
        options: normalizedOptions,
        resultPath,
        status
      }
    });

    Atomics.wait(status, 0, 0, 120000);
    const statusCode = Atomics.load(status, 0);
    if (!fs.existsSync(resultPath)) {
      throw new Error(statusCode === -1 ? 'Image tracing worker failed without a result' : 'Image tracing worker timed out');
    }
    const result = fs.readFileSync(resultPath, 'utf8');
    if (statusCode === -1) throw new Error(`Image tracing failed: ${result.split('\n')[0]}`);
    if (statusCode !== 1) throw new Error('Image tracing worker did not complete');
    return result;
  } finally {
    if (worker) worker.terminate();
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  traceImage,
  normalizeOptions,
  detectFormat
};
