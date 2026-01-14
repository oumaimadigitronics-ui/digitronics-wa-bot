import express from "express";
import { registerProcessHandlers } from "./processHandlers.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", true);
  registerProcessHandlers();
  return app;
}
