import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    external: ['node:sqlite', 'sqlite'],
  },
  test: {
    environment: 'node',
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
