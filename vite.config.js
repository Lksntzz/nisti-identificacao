import { defineConfig } from 'vite';

// O mesmo identificador entra no bundle do monitor e no arquivo de consulta.
// A cada deploy, um novo build ID permite atualizar o terminal sem reinstalar.
const monitorBuildId=(process.env.GITHUB_SHA?.slice(0,12)||'local')+'-'+Date.now().toString(36);

export default defineConfig({
  define: {
    __NISTI_MONITOR_BUILD_ID__: JSON.stringify(monitorBuildId)
  },
  plugins: [{
    name: 'nisti-monitor-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'monitor-build.json',
        source: JSON.stringify({ id: monitorBuildId })
      });
    }
  }],
  build: {
    outDir: 'dist',
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false
  },
  server: {
    host: '0.0.0.0',
    port: 3000
  }
});
