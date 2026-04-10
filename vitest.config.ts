import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__test__/**/*.test.ts', '__test__/**/*.e2e.ts'],
  },
});
