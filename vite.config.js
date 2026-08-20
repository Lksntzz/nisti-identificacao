import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false
  },
  server: {
    port: 3000
  }
});
