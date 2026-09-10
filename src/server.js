const path = require('path');
const express = require('express');
const { traceImage } = require('./tracer');
const { loadImage } = require('./image-processor');

const ROOT_DIRECTORY = path.resolve(__dirname, '..');
const PUBLIC_DIRECTORY = path.join(ROOT_DIRECTORY, 'public');
const IMAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'test-images');

function createApp() {
  const app = express();

  app.use((request, response, next) => {
    console.log(`${new Date().toISOString()} ${request.method} ${request.originalUrl}`);
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  app.use('/test-images', express.static(IMAGE_DIRECTORY));
  app.use(express.static(PUBLIC_DIRECTORY));

  app.get('/', (request, response) => {
    response.sendFile(path.join(PUBLIC_DIRECTORY, 'index.html'));
  });

  app.post('/api/trace', (request, response) => {
    try {
      const imagePath = request.body && request.body.imagePath;
      if (typeof imagePath !== 'string' || path.basename(imagePath) !== imagePath) {
        response.status(400).json({ error: 'imagePath must be a file name' });
        return;
      }
      const options = request.body.options && typeof request.body.options === 'object'
        ? request.body.options
        : {};
      const svg = traceImage(loadImage(path.join(IMAGE_DIRECTORY, imagePath)), options);
      response.json({ svg });
    } catch (error) {
      console.error(error.stack || error.message);
      response.status(500).json({ error: error.message });
    }
  });

  app.use((request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  return app;
}

function startServer(port = Number(process.env.PORT) || 3000) {
  const app = createApp();
  return app.listen(port, () => {
    console.log(`Image tracer server listening on http://localhost:${port}`);
  });
}

if (require.main === module) startServer();

module.exports = {
  createApp,
  startServer
};
