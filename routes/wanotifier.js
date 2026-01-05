function registerWanotifierRoute(app, handler) {
  app.post("/wanotifier", handler);
}

export { registerWanotifierRoute };
