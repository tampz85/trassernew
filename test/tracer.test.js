const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { traceImage, loadImage, saveSVG, compareImages } = require('../src');

describe('image tracer', () => {
  let temporaryDirectory;
  let imagePath;

  beforeEach(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-test-'));
    imagePath = path.join(temporaryDirectory, 'source.png');
    await sharp(Buffer.from('<svg width="32" height="32"><rect width="32" height="32" fill="white"/><rect x="7" y="7" width="10" height="10" fill="#dc1e28"/><rect x="17" y="17" width="10" height="10" fill="#1450dc"/></svg>'))
      .png()
      .toFile(imagePath);
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('loads a PNG, traces it, and saves SVG', () => {
    const outputPath = path.join(temporaryDirectory, 'result.svg');
    const svg = traceImage(loadImage(imagePath), { threshold: 128, minArea: 4 });
    saveSVG(svg, outputPath);
    expect(fs.readFileSync(outputPath, 'utf8')).toContain('<svg');
    expect(svg).toContain('<path');
  });

  test('rejects an invalid image', () => {
    expect(() => traceImage(Buffer.from('not an image'))).toThrow(/Unsupported image format|Image tracing failed/);
  });

  test('compares identical and different SVG strings', () => {
    expect(compareImages('<svg><path d="M0 0"/></svg>', '<svg><path d="M0 0"/></svg>')).toBe(true);
    expect(compareImages('<svg><path d="M0 0"/></svg>', '<svg><path d="M0 1"/></svg>')).toBe(false);
  });
});
