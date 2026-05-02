const express = require('express');
const { registerChatRoutes } = require('./chat_routes');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

registerChatRoutes(app);

const port = Number(process.env.CHAT_PORT || 8093);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`chat_service listening on http://127.0.0.1:${port}`);
});
