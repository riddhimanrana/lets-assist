import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cfg = JSON.parse(readFileSync('.design-sync/config.json', 'utf8'));
const map = cfg.componentSrcMap;
const files = [...new Set(Object.values(map))].sort();

const lines = files.map((f) => `export * from ${JSON.stringify(resolve(f))};`);
// `export *` never forwards a default export — add an explicit named
// re-export for any component whose source uses `export default`.
for (const [name, file] of Object.entries(map)) {
  const src = readFileSync(file, 'utf8');
  const isDefault = new RegExp(`export default (?:function )?${name}\\b`).test(src);
  if (isDefault) {
    lines.push(`export { default as ${name} } from ${JSON.stringify(resolve(file))};`);
  }
}

writeFileSync('.design-sync/.manual-entry.mjs', lines.join('\n') + '\n');
console.log(`entry: ${lines.length} export line(s) -> .design-sync/.manual-entry.mjs`);
