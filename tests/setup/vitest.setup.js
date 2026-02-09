import '@testing-library/jest-dom/vitest';

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = MockResizeObserver;
}

function createMatchMedia() {
  return (query) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: createMatchMedia(),
  });
}

if (!globalThis.matchMedia) {
  globalThis.matchMedia = createMatchMedia();
}

if (typeof window !== 'undefined') {
  window.scrollTo = () => {};

  const hasLocalStorageApi = window.localStorage
    && typeof window.localStorage.getItem === 'function'
    && typeof window.localStorage.setItem === 'function'
    && typeof window.localStorage.removeItem === 'function';

  if (!hasLocalStorageApi) {
    const storage = new Map();
    const localStorageMock = {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(String(key), String(value));
      },
      removeItem(key) {
        storage.delete(String(key));
      },
      clear() {
        storage.clear();
      },
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
  }
}
