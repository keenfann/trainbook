export function registerSystemRoutes(app, { getCsrfToken }) {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/csrf', (req, res) => {
    res.json({ csrfToken: getCsrfToken(req) });
  });
}
