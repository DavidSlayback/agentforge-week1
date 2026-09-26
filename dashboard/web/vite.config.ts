import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The SPA is served by the BFF under /dashboard/ (same origin, MIGRATION-REACT.md §2.1).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/dashboard/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    // No inline modulepreload polyfill script: CSP is script-src 'self'.
    modulePreload: { polyfill: false },
  },
});
