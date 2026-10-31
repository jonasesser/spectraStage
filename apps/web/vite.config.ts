import { cpSync, createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** One id per build: in asset-manifest.json and in the bundle (projectors reload on a new one). */
const BUILD_ID = Date.now().toString(36);

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
        source: JSON.stringify({ version: BUILD_ID, files: ['/', ...files] }, null, 1),
      });
    },
  };
}

/**
 * MediaPipe runtime (WebAssembly) for the zombie camera, served from our own origin under
 * /mediapipe/wasm (not precached by the service worker – only projector PCs load it on demand).
 */
function mediapipeWasm(): Plugin {
  const src = resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
  return {
    name: 'spectrastage-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const f = join(src, (req.url ?? '').split('?')[0]!.replace(/^\/+/, ''));
        if (!f.startsWith(src) || !existsSync(f)) return next();
        if (f.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        createReadStream(f).pipe(res);
      });
    },
    closeBundle() {
      const out = resolve(__dirname, 'dist/mediapipe/wasm');
      if (existsSync(src)) cpSync(src, out, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), assetManifest(), mediapipeWasm()],
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID) },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200, sourcemap: false },
});
