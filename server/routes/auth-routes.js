export function registerAuthRoutes(app, {
  db,
  bcrypt,
  nowIso,
  normalizeText,
  getCsrfToken,
  requireAuth,
}) {
  app.get('/api/auth/me', (req, res) => {
    if (!req.session.userId) {
      return res.json({ user: null });
    }
    const user = db
      .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
      .get(req.session.userId);
    return res.json({ user: user || null });
  });

  app.post('/api/auth/register', async (req, res) => {
    const username = normalizeText(req.body?.username);
    const password = normalizeText(req.body?.password);

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const createdAt = nowIso();
    const result = db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
      )
      .run(username, passwordHash, createdAt);
    const userId = Number(result.lastInsertRowid);
    req.session.userId = userId;
    getCsrfToken(req);
    return res.json({
      user: { id: userId, username, created_at: createdAt },
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const username = normalizeText(req.body?.username);
    const password = normalizeText(req.body?.password);

    const user = db
      .prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?')
      .get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    req.session.userId = user.id;
    getCsrfToken(req);
    return res.json({ user: { id: user.id, username: user.username, created_at: user.created_at } });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.post('/api/auth/password', requireAuth, async (req, res) => {
    const currentPassword = normalizeText(req.body?.currentPassword);
    const nextPassword = normalizeText(req.body?.nextPassword);

    if (nextPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const user = db
      .prepare('SELECT id, password_hash FROM users WHERE id = ?')
      .get(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const passwordHash = await bcrypt.hash(nextPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      passwordHash,
      req.session.userId
    );
    return res.json({ ok: true });
  });
}
