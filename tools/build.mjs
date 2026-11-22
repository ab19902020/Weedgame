// Bundles the runtime into www/app.js (ES module) and www/worker.js (classic worker).
import * as esbuild from 'esbuild';
const watch = process.argv.includes('--watch');
const common = { bundle: true, minify: !process.argv.includes('--dev'), sourcemap: process.argv.includes('--dev') ? 'inline' : false, target: ['chrome110'], logLevel: 'info', legalComments: 'none' };
const ctxs = [
  await esbuild.context({ ...common, entryPoints: ['src/app.js'], outfile: 'www/app.js', format: 'esm' }),
  await esbuild.context({ ...common, entryPoints: ['src/tileWorker.js'], outfile: 'www/worker.js', format: 'iife' }),
];
if (watch) { for (const c of ctxs) await c.watch(); }
else { for (const c of ctxs) { await c.rebuild(); await c.dispose(); } }
