import crypto from 'node:crypto';

function timingSafeEqual(a, b) {
  const abuf = Buffer.from(a);
  const bbuf = Buffer.from(b);
  if (abuf.length !== bbuf.length) return false;
  return crypto.timingSafeEqual(abuf, bbuf);
}

export function authWanotifier(cfg) {
  return (req, res, next) => {
    const token = cfg.WANOTIFIER_TOKEN || '';
    if (token) {
      const bearer = req.headers.authorization?.split('Bearer ')[1];
      const headerToken = req.headers['x-wanotifier-token'] || bearer;
      if (!headerToken || headerToken !== token) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    const secret = cfg.WANOTIFIER_HMAC_SECRET || '';
    if (!secret) return next();

    const sigHeader = cfg.WANOTIFIER_HMAC_HEADER || 'x-signature';
    const tsHeader = cfg.WANOTIFIER_TS_HEADER || 'x-timestamp';
    const tsRaw = req.headers[tsHeader];
    const signature = req.headers[sigHeader];
    if (!signature || !tsRaw) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const now = Math.floor(Date.now() / 1000);
    const skew = Math.abs(now - ts);
    if (skew > cfg.WANOTIFIER_MAX_SKEW_SECONDS) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const expected = crypto.createHmac('sha256', secret).update(`${ts}.${req.rawBody || ''}`).digest('hex');
    if (!timingSafeEqual(expected, signature)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    return next();
  };
}
