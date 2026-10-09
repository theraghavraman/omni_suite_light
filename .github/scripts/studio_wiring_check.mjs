// Static checks for the browser-only Office Tools and Diagram Forge studios.
// - every element id the studio scripts look up exists in index.html
// - studio stylesheets and scripts referenced by index.html exist on disk
// - every on-demand library is pinned to an exact version and listed in prepare_offline.py
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const offline = readFileSync('prepare_offline.py', 'utf8');
const loader = readFileSync('omni_vendor_loader.js', 'utf8');
const failures = [];

const RUNTIME_IDS = new Set(['ot-x-more', 'ot-deck-css', 'df-grid-pat']);
for (const file of ['office_tools_studio.js', 'diagram_forge_studio.js', 'office_find_replace.js', 'photo_editor.js', 'etl_studio.js']) {
  const src = readFileSync(file, 'utf8');
  const ids = new Set([...src.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]));
  for (const id of ids) {
    if (RUNTIME_IDS.has(id)) continue;
    if (!html.includes(`id="${id}"`)) failures.push(`${file}: element #${id} is not in index.html`);
  }
  if (/getElementById\([^)]*\s[^)]*\)|\$\('[^']*\s[^']*'\)/.test(src)) failures.push(`${file}: getElementById/$() called with a CSS selector`);
  console.log(`${file}: ${ids.size} element ids checked`);
}

for (const asset of ['office_tools_studio.css', 'diagram_forge_studio.css', 'office_find_replace.css', 'photo_editor.css', 'photo_editor.js', 'etl_studio.css', 'etl_studio.js', 'omni_vendor_loader.js', 'office_tools_studio.js', 'diagram_forge_studio.js', 'office_find_replace.js']) {
  if (!html.includes(`./${asset}`)) failures.push(`index.html does not reference ${asset}`);
  if (!existsSync(asset)) failures.push(`${asset} is missing`);
}
if (html.indexOf('src="./omni_vendor_loader.js') > html.indexOf('src="./office_tools_studio.js')) failures.push('omni_vendor_loader.js must load before office_tools_studio.js');

for (const m of loader.matchAll(/local:'([^']+)',cdn:'([^']+)'/g)) {
  const [, local, cdn] = m;
  if (!/@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\/|xlsx-\d+\.\d+\.\d+/.test(cdn)) failures.push(`unpinned CDN URL: ${cdn}`);
  const rel = local.replace(/^vendor\//, '');
  if (!offline.includes(`"${rel}"`)) failures.push(`prepare_offline.py does not download ${rel}`);
}

if (failures.length) {
  console.error('Studio wiring check failed:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('Studio wiring check passed.');
