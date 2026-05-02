function registerHealthRoutes(app, runtime) {
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      service: 'main_runtime',
      ts: new Date().toISOString(),
      runtime,
    });
  });
}

module.exports = {
  registerHealthRoutes,
};
