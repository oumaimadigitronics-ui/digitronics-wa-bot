import { Router } from 'express';

export function offersRouter(_cfg, services = {}) {
  const r = Router();
  const offersService = services.offersService;

  r.get('/offers-status', async (_req, res, next) => {
    try {
      const status = (await offersService?.getStatus?.()) || { ok: true };
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  r.post('/refresh-offers', async (_req, res, next) => {
    try {
      await offersService?.refresh?.();
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
