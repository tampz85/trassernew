const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

function isPngBuffer(buffer) {
  return buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e &&
    buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a &&
    buffer[6] === 0x1a && buffer[7] === 0x0a;
}

function isSvgValue(value) {
  if (Buffer.isBuffer(value)) {
    const start = value.subarray(0, 32).toString('utf8').trimStart();
    return start.startsWith('<svg') || start.startsWith('<?xml');
  }
  if (typeof value !== 'string') return false;
  if (/^\s*(?:<\?xml|<svg)/i.test(value)) return true;
  return path.extname(value).toLowerCase() === '.svg' && fs.existsSync(value);
}

async function rasterize(input) {
  if (Buffer.isBuffer(input) && isPngBuffer(input)) return PNG.sync.read(input);
  if (typeof input === 'string' && fs.existsSync(input) && path.extname(input).toLowerCase() === '.png') {
    return PNG.sync.read(fs.readFileSync(input));
  }
  if (isSvgValue(input)) {
    let svg = Buffer.isBuffer(input) ? input : fs.existsSync(input) ? fs.readFileSync(input) : Buffer.from(input);
    const source = svg.toString('utf8');
    if (!/\s(?:width|height|viewBox)=/i.test(source)) {
      svg = Buffer.from(source.replace(/^<svg/i, '<svg width="200" height="200" viewBox="0 0 200 200"'));
    }
    const png = await sharp(svg).png().toBuffer();
    return PNG.sync.read(png);
  }
  if (typeof input === 'string' && fs.existsSync(input)) return PNG.sync.read(fs.readFileSync(input));
  if (Buffer.isBuffer(input)) return PNG.sync.read(input);
  throw new TypeError('Expected a PNG or SVG path, buffer, or SVG string');
}

function paddedPng(source, width, height) {
  if (source.width === width && source.height === height) return source;
  const result = new PNG({ width, height });
  result.data.fill(255);
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = y * width * 4;
    source.data.copy(result.data, targetStart, sourceStart, sourceStart + source.width * 4);
  }
  return result;
}

async function compareScreenshots(actual, expected, threshold = 0.05) {
  const actualPng = await rasterize(actual);
  const expectedPng = await rasterize(expected);
  const width = Math.max(actualPng.width, expectedPng.width);
  const height = Math.max(actualPng.height, expectedPng.height);
  const normalizedActual = paddedPng(actualPng, width, height);
  const normalizedExpected = paddedPng(expectedPng, width, height);
  const diff = new PNG({ width, height });
  const differentPixels = pixelmatch(
    normalizedActual.data,
    normalizedExpected.data,
    diff.data,
    width,
    height,
    { threshold: 0.1, includeAA: false }
  );
  const percentage = width * height === 0 ? 0 : (differentPixels / (width * height)) * 100;
  const allowedPercentage = threshold > 1 ? threshold : threshold * 100;
  if (percentage > allowedPercentage) {
    throw new Error(`Screenshot difference ${percentage.toFixed(4)}% exceeds threshold ${allowedPercentage.toFixed(2)}%`);
  }
  return percentage;
}

module.exports = {
  compareScreenshots,
  rasterize
};
