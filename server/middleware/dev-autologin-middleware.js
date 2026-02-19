import { shouldApplyDevAutologin } from '../dev-autologin.js';

export function createDevAutologinMiddleware({ enabled, allowRemote, getOrCreateDevUser }) {
  return (req, res, next) => {
    const shouldAutologin = shouldApplyDevAutologin(req, {
      enabled,
      allowRemote,
    });
    if (!shouldAutologin) {
      return next();
    }
    if (!req.session?.userId) {
      const userId = getOrCreateDevUser();
      req.session.userId = userId;
    }
    return next();
  };
}
