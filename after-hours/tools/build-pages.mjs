// Builds the static, single-player site for GitHub Pages into ./dist (or the path given).
// Usage: node tools/build-pages.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), out, { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(out, 'shared'), { recursive: true });
fs.mkdirSync(path.join(out, 'server'), { recursive: true });
for (const f of ['game.js', 'mapgen.js', 'pathfind.js']) {
  fs.copyFileSync(path.join(ROOT, 'server', f), path.join(out, 'server', f));
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Static site written to ${out}`);
