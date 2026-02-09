function readForwardedFor(req) {
  if (!req) return '';
  if (typeof req.get === 'function') {
    return String(req.get('x-forwarded-for') || '').trim();
  }
  const header = req.headers?.['x-forwarded-for'];
  return String(header || '').trim();
}

export function isLocalDevRequest(req) {
  if (!req) return false;
  const ip = String(req.ip || '').trim();
  const hostname = String(req.hostname || '').trim().toLowerCase();
  const forwardedFor = readForwardedFor(req);
  const isLoopbackIp =
    ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return isLoopbackIp || (!forwardedFor && hostname === 'localhost');
}

export function shouldApplyDevAutologin(
  req,
  { enabled = false, allowRemote = false } = {}
) {
  if (!enabled) return false;
  if (allowRemote) return true;
  return isLocalDevRequest(req);
}
