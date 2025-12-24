import express from 'express';

export function rawBodyJson() {
  return express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  });
}
