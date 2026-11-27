import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/simulation/**/*.test.ts'],
    globals: false,
  },
});
