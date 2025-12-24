export function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, _req, res, _next) => {
    const status = err?.status || 500;
    res.status(status).json({ ok: false, error: err?.message || 'Internal error' });
  };
}
