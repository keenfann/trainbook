import { APP_ROUTE_ORDER } from './constants.js';

export function resolveTopLevelPath(pathname) {
  if (!pathname || pathname === '/') return '/workout';
  const firstSegment = String(pathname)
    .split('/')
    .filter(Boolean)[0];
  const normalized = `/${firstSegment || 'workout'}`;
  return Object.prototype.hasOwnProperty.call(APP_ROUTE_ORDER, normalized) ? normalized : '/workout';
}

export function resolveRouteOrder(pathname) {
  return APP_ROUTE_ORDER[resolveTopLevelPath(pathname)] ?? 0;
}
