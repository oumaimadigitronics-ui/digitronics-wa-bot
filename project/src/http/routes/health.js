import { Router } from 'express';

export function healthRouter() {
  const r = Router();
  r.get('/health', (_req, res) => res.json({ ok: true }));
  r.get('/ready', (_req, res) => res.json({ ok: true }));
  return r;
}
