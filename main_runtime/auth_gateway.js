const { signToken, verifyToken, extractBearerToken } = require('../shared/auth_session');

function registerAuthGateway(app) {
  app.post('/api/auth/session', (req, res) => {
    const password = String(req.body?.password || '').trim();
    if (!password) {
      res.status(400).json({
        success: false,
        error: 'password required',
      });
      return;
    }
    const token = signToken({
      sub: 'market-user',
      role: 'user',
      meta: {
        passwordPresent: true,
      },
    });
    res.json({
      success: true,
      token,
      expiresInSec: 12 * 60 * 60,
    });
  });

  app.get('/api/auth/session/verify', (req, res) => {
    try {
      const token = extractBearerToken(req);
      const session = verifyToken(token);
      res.json({
        success: true,
        session,
      });
    } catch (err) {
      res.status(401).json({
        success: false,
        error: String(err?.message || 'unauthorized'),
        code: String(err?.code || 'UNAUTHORIZED'),
      });
    }
  });
}

module.exports = {
  registerAuthGateway,
};
