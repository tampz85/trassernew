# Image Tracing App

Browser and Node.js application for converting raster PNG and JPEG images into SVG outlines.

## Project layout

- `src/` — tracing implementation and server entry points
- `test/` — unit and visual test runners
- `test-images/` — source images used by automated and visual checks
- `test-results/` — generated screenshots and logs (ignored by Git)
- `public/` — browser test interface and static assets

## Requirements

- Node.js 18 or newer
- npm

## Install

```bash
npm install
```

## Commands

```bash
npm start       # Start the Express visual-test server
npm trace       # Run the command-line tracer
npm test        # Run Jest unit tests
npm run test:visual  # Run browser-based visual checks with Puppeteer
```

## Usage

The application uses `sharp` for image decoding and normalization and `imagetracerjs` for raster-to-SVG tracing. The same tracing logic is intended to be shared by the Node.js CLI and browser interface. Place test images in `test-images/`; generated visual-test artifacts are written to `test-results/`.
