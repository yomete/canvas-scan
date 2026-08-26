import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['canvas-scan'] },
  build: {
    // sampling.html is a fixture rather than a page anyone navigates to, but
    // the browser tests run against the built output, so it has to be built.
    rollupOptions: { input: { index: page('index.html'), sampling: page('sampling.html') } },
  },
});
