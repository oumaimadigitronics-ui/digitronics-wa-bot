import { createServer } from 'http';
import { loadEnv } from './config/env.js';
import { buildServices } from './services/index.js';
import { createApp } from './app.js';

const cfg = loadEnv(process.env);
const services = buildServices(cfg);
const app = createApp({ cfg, services });

const server = createServer(app);
const port = cfg.PORT || 3000;

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${port}`);
});
