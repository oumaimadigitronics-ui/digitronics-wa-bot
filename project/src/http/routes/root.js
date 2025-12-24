import { Router } from 'express';

export function rootRouter(cfg) {
  const r = Router();
  r.get('/', (_req, res) => {
    res.json({ ok: true, focus: cfg.FOCUS_BRAND || null });
  });
  return r;
}
