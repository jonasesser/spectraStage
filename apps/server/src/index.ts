import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
if (!config.webRoot) {
  // dist/index.js -> ../../web/dist ; src/index.ts -> ../../web/dist
  const candidate = join(here, '..', '..', 'web', 'dist');
  if (existsSync(candidate)) config.webRoot = candidate;
}

const ctx = await buildApp(config, catalog);
await ctx.app.listen({ port: config.port, host: config.host });
ctx.app.log.info(
  { port: config.port, publicUrl: config.publicUrl, db: config.databasePath, web: config.webRoot },
  'SpectraStage server ready',
);

let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.app.log.info({ sig }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    ctx
      .close()
      .then(() => {
        clearTimeout(force);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  });
}
