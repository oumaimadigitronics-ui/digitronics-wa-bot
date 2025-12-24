import { Router } from 'express';

export function wanotifierRouter(cfg, services = {}) {
  const r = Router();
  const botService = services.botService;

  r.post('/', async (req, res, next) => {
    try {
      const context = { rawBody: req.rawBody, requestId: req.id };
      const result = await botService?.handleNotification?.(req.body, context);
      res.json(result || { ok: true });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
