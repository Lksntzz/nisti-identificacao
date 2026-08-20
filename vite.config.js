import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('src/main.jsx')) {
            return 'admin-app';
          }
          if (id.includes('src/public-main.jsx')) {
            return 'operator-app';
          }
        }
      }
    }
  },
  server: {
    port: 3000
  }
});
