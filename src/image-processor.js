const fs = require('fs');
const path = require('path');

function loadImage(imagePath) {
  if (typeof imagePath !== 'string' || imagePath.length === 0) {
    throw new TypeError('Image path must be a non-empty string');
  }
  return fs.readFileSync(imagePath);
}

function saveSVG(svgString, outputPath) {
  if (typeof svgString !== 'string' || svgString.length === 0) {
    throw new TypeError('SVG content must be a non-empty string');
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new TypeError('Output path must be a non-empty string');
  }
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, svgString);
  return resolvedPath;
}

function compareImages(svg1, svg2) {
  const normalize = (value) => String(value).replace(/\s+/g, ' ').trim();
  return normalize(svg1) === normalize(svg2);
}

module.exports = {
  loadImage,
  saveSVG,
  compareImages
};
