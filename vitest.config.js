import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  ssr: {
    external: ['node:sqlite', 'sqlite'],
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup/vitest.setup.js'],
    include: ['tests/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['temp/**', 'node_modules/**'],
    threads: false,
    server: {
      deps: {
        external: ['node:sqlite', 'sqlite'],
      },
    },
    deps: {
      optimizer: {
        ssr: {
          exclude: ['node:sqlite', 'sqlite'],
        },
      },
    },
  },
});
