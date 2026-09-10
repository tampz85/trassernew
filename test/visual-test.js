const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { traceImage } = require('../src/tracer');
const { loadImage, saveSVG } = require('../src/image-processor');
const { compareScreenshots } = require('./visual-compare');

const ROOT_DIRECTORY = path.resolve(__dirname, '..');
const IMAGE_PATH = path.join(ROOT_DIRECTORY, 'test-images', 'test1.png');
const RESULTS_DIRECTORY = path.join(ROOT_DIRECTORY, 'test-results');
const OUTPUT_SVG_PATH = path.join(RESULTS_DIRECTORY, 'output.svg');
const SCREENSHOT_PATH = path.join(RESULTS_DIRECTORY, 'visual-test-1.png');
const ETALON_PATH = path.join(RESULTS_DIRECTORY, 'etalon-1.png');
const LOG_PATH = path.join(RESULTS_DIRECTORY, 'visual-test.log');

function writeLog(message) {
  fs.appendFileSync(LOG_PATH, `${message}\n`);
  process.stdout.write(`${message}\n`);
}

async function runVisualTest(options = {}) {
  const baseUrl = options.baseUrl || process.env.VISUAL_TEST_URL || 'http://127.0.0.1:3100';
  const traceOptions = options.traceOptions || { threshold: 128, minArea: 4 };
  const threshold = options.threshold === undefined ? 0.05 : options.threshold;
  fs.mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  fs.writeFileSync(LOG_PATH, '');

  if (!fs.existsSync(IMAGE_PATH)) throw new Error(`Test image does not exist: ${IMAGE_PATH}`);
  const inputBuffer = loadImage(IMAGE_PATH);
  const svg = traceImage(inputBuffer, traceOptions);
  saveSVG(svg, OUTPUT_SVG_PATH);
  writeLog(`stdout: traced ${path.relative(ROOT_DIRECTORY, IMAGE_PATH)} -> ${path.relative(ROOT_DIRECTORY, OUTPUT_SVG_PATH)}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 520, deviceScaleFactor: 1 });
    page.on('console', (message) => writeLog(`browser ${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => writeLog(`browser pageerror: ${error.stack || error.message}`));
    await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(async (tracePayload) => window.runBrowserTest(tracePayload), traceOptions);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    writeLog(`stdout: screenshot saved to ${path.relative(ROOT_DIRECTORY, SCREENSHOT_PATH)}`);

    let difference;
    if (fs.existsSync(ETALON_PATH)) {
      difference = await compareScreenshots(SCREENSHOT_PATH, ETALON_PATH, threshold);
      writeLog(`stdout: difference ${difference.toFixed(4)}% (threshold ${(threshold > 1 ? threshold : threshold * 100).toFixed(2)}%)`);
    } else {
      fs.copyFileSync(SCREENSHOT_PATH, ETALON_PATH);
      writeLog('stdout: reference screenshot created');
      difference = 0;
    }

    writeLog('stdout: visual test passed');
    return { ok: true, difference, screenshotPath: SCREENSHOT_PATH, etalonPath: ETALON_PATH };
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
  runVisualTest
};
