export function createCsrfProtectionMiddleware({ methods, headerName }) {
  return (req, res, next) => {
    if (!methods.has(req.method)) {
      return next();
    }
    const sessionToken = req.session?.csrfToken;
    const headerToken = req.get(headerName);
    if (!sessionToken || !headerToken || sessionToken !== headerToken) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    return next();
  };
}
