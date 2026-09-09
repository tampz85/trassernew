const { traceImage } = require('./tracer');
const { loadImage, saveSVG, compareImages } = require('./image-processor');

function parseNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function parsePalette(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid palette JSON: ${error.message}`);
  }
}

function parseArguments(argumentsList) {
  const options = {};
  let inputPath;
  let outputPath;

  argumentsList.forEach((argument) => {
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      return;
    }
    if (!argument.startsWith('--')) {
      if (!inputPath) inputPath = argument;
      else if (!outputPath) outputPath = argument;
      else throw new Error(`Unexpected argument: ${argument}`);
      return;
    }

    const separator = argument.indexOf('=');
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    const value = separator === -1 ? true : argument.slice(separator + 1);
    if (name === 'threshold') options.threshold = parseNumber(value, 'threshold');
    else if (name === 'blur') options.blur = parseNumber(value, 'blur');
    else if (name === 'min-area') options.minArea = parseNumber(value, 'min-area');
    else if (name === 'palette') options.palette = parsePalette(value);
    else throw new Error(`Unknown option: ${name}`);
  });

  return { inputPath, outputPath, options };
}

function main(argumentsList = process.argv.slice(2)) {
  const { inputPath, outputPath, options } = parseArguments(argumentsList);
  if (options.help) {
    process.stdout.write('Usage: node src/index.js input.png output.svg [--threshold=128] [--blur=0] [--min-area=0] [--palette=JSON]\n');
    return;
  }
  if (!inputPath || !outputPath) throw new Error('Input and output paths are required');
  const svg = traceImage(loadImage(inputPath), options);
  saveSVG(svg, outputPath);
  process.stdout.write(`Traced ${inputPath} -> ${outputPath}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  traceImage,
  loadImage,
  saveSVG,
  compareImages,
  parseArguments,
  main
};
