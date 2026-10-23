import { build } from 'esbuild';

// Bundle the server and all workspace packages into one file; keep npm deps external.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  plugins: [
    {
      name: 'externalize-npm',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@spectrastage/')) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
console.log('server bundle written to dist/index.js');
