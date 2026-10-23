import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Emits asset-manifest.json so the service worker can precache the whole build. */
function assetManifest(): Plugin {
  return {
    name: 'spectrastage-asset-manifest',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).map((f) => `/${f}`);
      this.emitFile({
        type: 'asset',
        fileName: 'asset-manifest.json',
        source: JSON.stringify({ version: Date.now().toString(36), files: ['/', ...files] }, null, 1),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), assetManifest()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200, sourcemap: false },
});
