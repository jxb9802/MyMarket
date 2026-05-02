function registerChatRoutes(app) {
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      service: 'chat_service',
      ts: new Date().toISOString(),
    });
  });

  app.get('/api/chat/summary', (_req, res) => {
    res.json({
      success: true,
      summary: {
        ready: true,
        note: 'chat_service skeleton',
      },
    });
  });
}

module.exports = {
  registerChatRoutes,
};
