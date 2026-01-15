import express from 'express';
import { rawBodyJson } from './http/middleware/rawBodyJson.js';
import { requestId } from './http/middleware/requestId.js';
import { authWanotifier } from './http/middleware/authWanotifier.js';
import { rateLimit } from './http/middleware/rateLimit.js';
import { errorHandler } from './http/middleware/errorHandler.js';
import { rootRouter } from './http/routes/root.js';
import { healthRouter } from './http/routes/health.js';
import { offersRouter } from './http/routes/offers.js';
import { wanotifierRouter } from './http/routes/wanotifier.js';

export function createApp({ cfg, services }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(rawBodyJson());

  app.use('/', rootRouter(cfg));
  app.use('/', healthRouter());
  app.use('/', offersRouter(cfg, services));
  app.use('/wanotifier', authWanotifier(cfg));
  app.use('/wanotifier', rateLimit(cfg));
  app.use('/wanotifier', wanotifierRouter(cfg, services));

  app.use(errorHandler());
  return app;
}
