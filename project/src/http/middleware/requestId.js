import crypto from 'node:crypto';

export function requestId() {
  return (req, _res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    next();
  };
}
