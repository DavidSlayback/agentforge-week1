// Print the gzip size of the built SPA's JS and CSS and fail above the JS
// budget (MIGRATION-REACT.md §6.4). Raising the budget needs a DEV-LOG entry.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const JS_BUDGET_BYTES = 150 * 1024;
const dist = fileURLToPath(new URL('../web/dist', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let files;
try {
  files = walk(dist);
} catch {
  console.error('bundle-report: web/dist is missing; run the vite build first');
  process.exit(1);
}
const total = { js: 0, css: 0 };
for (const f of files) {
  const kind = f.endsWith('.js') ? 'js' : f.endsWith('.css') ? 'css' : null;
  if (kind) total[kind] += gzipSync(readFileSync(f)).length;
}
const kb = (n) => (n / 1024).toFixed(1);
console.log(`bundle-report: JS ${kb(total.js)} kB gzip (budget ${kb(JS_BUDGET_BYTES)} kB), CSS ${kb(total.css)} kB gzip`);
if (total.js > JS_BUDGET_BYTES) {
  console.error('bundle-report: JS bundle exceeds the budget');
  process.exit(1);
}
