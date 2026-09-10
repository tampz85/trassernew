const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { traceImage } = require('../src/tracer');
const { loadImage, saveSVG } = require('../src/image-processor');
const { compareScreenshots } = require('./visual-compare');

const ROOT_DIRECTORY = path.resolve(__dirname, '..');
const IMAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'test-images');
const RESULTS_DIRECTORY = path.join(ROOT_DIRECTORY, 'test-results');
const OUTPUT_SVG_PATH = path.join(RESULTS_DIRECTORY, 'output.svg');
const LOG_PATH = path.join(RESULTS_DIRECTORY, 'visual-test.log');

const PROFILES = {
  'test1.png': { threshold: 128, blur: 0.4, minArea: 10, palette: 2, smooth: true },
  'test2.jpg': { blur: 0.5, minArea: 20, palette: 16, smooth: true },
  'test3.png': { threshold: 180, blur: 0.3, minArea: 10, palette: 8, smooth: false },
  'test4.png': { threshold: 160, blur: 0.4, minArea: 20, palette: 4, smooth: true }
};

function parseArguments(argumentsList) {
  const parsed = { imagePath: undefined, overrides: {} };
  argumentsList.forEach((argument) => {
    if (!argument.startsWith('--')) {
      if (!parsed.imagePath) parsed.imagePath = argument;
      else throw new Error(`Unexpected argument: ${argument}`);
      return;
    }
    const separator = argument.indexOf('=');
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    const rawValue = separator === -1 ? true : argument.slice(separator + 1);
    if (name === 'threshold' || name === 'blur' || name === 'min-area' || name === 'minArea' || name === 'palette' || name === 'smooth') {
      if (rawValue === true) throw new Error(`Missing value for --${name}`);
      if (name === 'smooth') parsed.overrides.smooth = rawValue === 'true';
      else if (name === 'min-area' || name === 'minArea') parsed.overrides.minArea = Number(rawValue);
      else parsed.overrides[name] = Number(rawValue);
    } else {
      throw new Error(`Unknown option: ${name}`);
    }
  });
  return parsed;
}

function resolveImage(imagePath) {
  const requestedPath = imagePath || 'test-images/test1.png';
  let absolutePath = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(process.cwd(), requestedPath);
  if (!fs.existsSync(absolutePath)) absolutePath = path.resolve(IMAGE_DIRECTORY, requestedPath);
  const relativePath = path.relative(IMAGE_DIRECTORY, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new Error('Image must be located in test-images/');
  if (!fs.existsSync(absolutePath)) throw new Error(`Test image does not exist: ${absolutePath}`);
  return { absolutePath, fileName: path.basename(absolutePath) };
}

function imageNumber(fileName) {
  const match = fileName.match(/^test(\d+)\./);
  return match ? match[1] : fileName.replace(/\.[^.]+$/, '');
}

function traceOptionsFor(fileName, overrides) {
  return { ...(PROFILES[fileName] || PROFILES['test1.png']), ...(overrides || {}) };
}

async function rasterAccuracy(imagePath, svg) {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width;
  const height = metadata.height;
  const originalBuffer = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tracedBuffer = await sharp(Buffer.from(svg)).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const originalPng = new PNG({ width, height });
  const tracedPng = new PNG({ width, height });
  originalPng.data.set(Buffer.from(originalBuffer.data));
  tracedPng.data.set(Buffer.from(tracedBuffer.data));
  const diff = new PNG({ width, height });
  const differentPixels = pixelmatch(originalPng.data, tracedPng.data, diff.data, width, height, { threshold: 0.12, includeAA: false });
  const difference = (differentPixels / (width * height)) * 100;
  return { accuracy: Math.max(0, 100 - difference), difference };
}

async function runVisualTest(options = {}) {
  const cli = options.cli || parseArguments(process.argv.slice(2));
  const { absolutePath: imagePath, fileName } = resolveImage(cli.imagePath || options.imagePath);
  const number = imageNumber(fileName);
  const traceOptions = traceOptionsFor(fileName, cli.overrides || options.traceOptions);
  const comparisonThreshold = options.threshold === undefined ? 0.05 : options.threshold;
  const baseUrl = options.baseUrl || process.env.VISUAL_TEST_URL || 'http://127.0.0.1:3100';
  const outputSvgPath = path.join(RESULTS_DIRECTORY, `output-${number}.svg`);
  const screenshotPath = path.join(RESULTS_DIRECTORY, `visual-test-${number}.png`);
  const etalonPath = path.join(RESULTS_DIRECTORY, `etalon-${number}.png`);
  const perImageLogPath = path.join(RESULTS_DIRECTORY, `visual-test-${number}.log`);

  fs.mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  fs.writeFileSync(LOG_PATH, '');
  fs.writeFileSync(perImageLogPath, '');
  const writeLog = (message) => {
    fs.appendFileSync(LOG_PATH, `${message}\n`);
    fs.appendFileSync(perImageLogPath, `${message}\n`);
    process.stdout.write(`${message}\n`);
  };

  const inputBuffer = loadImage(imagePath);
  const svg = traceImage(inputBuffer, traceOptions);
  saveSVG(svg, outputSvgPath);
  fs.copyFileSync(outputSvgPath, OUTPUT_SVG_PATH);
  const accuracy = await rasterAccuracy(imagePath, svg);
  writeLog(`stdout: traced test-images/${fileName} -> test-results/output-${number}.svg`);
  writeLog(`stdout: raster accuracy ${accuracy.accuracy.toFixed(2)}%`);

  let browser;
  try {
    const serverResponse = await fetch(baseUrl);
    if (!serverResponse.ok) throw new Error(`Visual-test server returned HTTP ${serverResponse.status}`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 520, deviceScaleFactor: 1 });
    page.on('console', (message) => writeLog(`browser ${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => writeLog(`browser pageerror: ${error.stack || error.message}`));
    await page.goto(`${baseUrl}/?image=${encodeURIComponent(fileName)}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(async (payload) => window.runBrowserTest(payload), { imagePath: fileName, options: traceOptions });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    writeLog(`stdout: screenshot saved to test-results/visual-test-${number}.png`);

    let difference;
    if (fs.existsSync(etalonPath)) {
      difference = await compareScreenshots(screenshotPath, etalonPath, comparisonThreshold);
      writeLog(`stdout: screenshot difference ${difference.toFixed(4)}% (threshold ${(comparisonThreshold > 1 ? comparisonThreshold : comparisonThreshold * 100).toFixed(2)}%)`);
    } else {
      fs.copyFileSync(screenshotPath, etalonPath);
      writeLog('stdout: reference screenshot created');
      difference = 0;
    }

    writeLog('stdout: visual test passed');
    return {
      ok: true,
      fileName,
      traceOptions,
      accuracy,
      screenshotDifference: difference,
      screenshotPath,
      etalonPath,
      outputSvgPath
    };
  } catch (error) {
    writeLog(`stderr: ${error.stack || error.message}`);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  runVisualTest().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = {
  parseArguments,
  resolveImage,
  traceOptionsFor,
  rasterAccuracy,
  runVisualTest
};
