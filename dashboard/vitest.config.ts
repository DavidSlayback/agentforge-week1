import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects: core + BFF + contract + lint in Node, the SPA in jsdom.
// Integration tests (*.it.ts) are opt-in and never run here (§6.3).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/core/**/*.test.ts', 'test/bff/**/*.test.ts', 'test/contract/**/*.test.ts', 'test/lint/**/*.test.ts'],
          testTimeout: 30000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['test/web/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
