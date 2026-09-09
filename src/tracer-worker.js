const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const sharp = require('sharp');
const ImageTracer = require('imagetracerjs');

function clonePalette(palette) {
  return palette.map((color) => ({ ...color }));
}

function pathArea(path) {
  const box = path.boundingbox || [];
  if (box.length < 4) return 0;
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

function filterSmallPaths(tracedata, minArea) {
  if (!(minArea > 0)) return tracedata;

  tracedata.layers = tracedata.layers.map((layer) => {
    const kept = [];
    const oldToNew = new Map();

    layer.forEach((path, index) => {
      if (pathArea(path) >= minArea) {
        oldToNew.set(index, kept.length);
        kept.push({ ...path, holechildren: [] });
      }
    });

    const nonHoles = kept.filter((path) => !path.isholepath);
    kept.forEach((path) => {
      if (!path.isholepath) return;
      const parent = nonHoles
        .filter((candidate) => {
          const a = candidate.boundingbox || [];
          const b = path.boundingbox || [];
          return a.length === 4 && b.length === 4 &&
            a[0] < b[0] && a[1] < b[1] && a[2] > b[2] && a[3] > b[3];
        })
        .sort((left, right) => {
          const leftArea = pathArea(left);
          const rightArea = pathArea(right);
          return leftArea - rightArea;
        })[0];

      if (parent) {
        const parentIndex = kept.indexOf(parent);
        parent.holechildren.push(parentIndex);
      } else {
        path.isholepath = false;
      }
    });

    return kept;
  });

  return tracedata;
}

function buildTracerOptions(options) {
  const palette = options.palette ? clonePalette(options.palette) : undefined;
  const tracerOptions = {
    ltres: Number.isFinite(options.ltres) ? options.ltres : 1,
    qtres: Number.isFinite(options.qtres) ? options.qtres : 1,
    pathomit: Number.isFinite(options.pathomit) ? options.pathomit : 8,
    rightangleenhance: options.rightangleenhance !== false,
    colorsampling: palette ? 0 : 2,
    numberofcolors: palette ? palette.length : 16,
    mincolorratio: 0,
    colorquantcycles: palette ? 1 : 3,
    layering: 0,
    strokewidth: Number.isFinite(options.strokewidth) ? options.strokewidth : 1,
    linefilter: false,
    scale: Number.isFinite(options.scale) ? options.scale : 1,
    roundcoords: Number.isFinite(options.roundcoords) ? options.roundcoords : 1,
    viewbox: Boolean(options.viewbox),
    desc: false,
    lcpr: 0,
    qcpr: 0,
    blurradius: 0,
    blurdelta: 20
  };

  if (palette) tracerOptions.pal = palette;
  return tracerOptions;
}

async function run() {
  const { inputBuffer, options, resultPath, status } = workerData;
  try {
    let pipeline = sharp(Buffer.from(inputBuffer), { failOn: 'none' });
    if (options.blur > 0) pipeline = pipeline.blur(options.blur);
    if (options.threshold !== undefined) pipeline = pipeline.threshold(options.threshold);

    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const imageData = { width: info.width, height: info.height, data };
    const tracerOptions = buildTracerOptions(options);
    const tracedata = ImageTracer.imagedataToTracedata(imageData, tracerOptions);
    filterSmallPaths(tracedata, options.minArea);
    const svg = ImageTracer.getsvgstring(tracedata, tracerOptions);
    fs.writeFileSync(resultPath, svg);
    Atomics.store(status, 0, 1);
    Atomics.notify(status, 0);
  } catch (error) {
    fs.writeFileSync(resultPath, error.stack || String(error));
    Atomics.store(status, 0, -1);
    Atomics.notify(status, 0);
  }
}

run();
