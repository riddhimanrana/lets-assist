const fs = require('fs');
const path = require('path');

const root = process.cwd();
const componentsDir = path.join(root, 'components');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fp = path.join(dir, file);
    const stat = fs.statSync(fp);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fp));
    } else {
      results.push(fp);
    }
  });
  return results;
}

function readAllFiles(dir) {
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.md'];
  const out = [];
  function rec(d) {
    const entries = fs.readdirSync(d);
    for (const e of entries) {
      const fp = path.join(d, e);
      const rel = path.relative(root, fp);
      if (rel.startsWith('.next') || rel.startsWith('node_modules') || rel.startsWith('.git')) continue;
      const st = fs.statSync(fp);
      if (st.isDirectory()) {
        rec(fp);
      } else {
        if (exts.includes(path.extname(fp))) out.push(fp);
      }
    }
  }
  rec(dir);
  return out;
}

if (!fs.existsSync(componentsDir)) {
  console.error('components directory not found at', componentsDir);
  process.exit(1);
}

const componentFiles = walk(componentsDir).filter((f) => /\.tsx?$/.test(f));
const allFiles = readAllFiles(root).filter((f) => !f.startsWith(componentsDir));

const results = [];

for (const comp of componentFiles) {
  const basename = path.basename(comp, path.extname(comp));
  const regex = new RegExp('\\b' + basename + '\\b', 'g');
  const matches = [];
  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (regex.test(content)) {
      matches.push(file);
    }
  }
  results.push({ file: path.relative(root, comp), name: basename, refs: matches });
}

// Print summary
console.log('Component usage scan - summary');
console.log('=================================');
let unused = 0;
for (const r of results) {
  const count = r.refs.length;
  if (count === 0) {
    console.log(`UNUSED: ${r.name} -> ${r.file}`);
    unused++;
  } else {
    console.log(`${r.name}: referenced in ${count} file(s)`);
  }
}
console.log('---------------------------------');
console.log(`Total components scanned: ${results.length}`);
console.log(`Unused candidates: ${unused}`);

// Output JSON for convenience
fs.writeFileSync(path.join(root, 'tmp-component-usage.json'), JSON.stringify(results, null, 2));
console.log('Detailed JSON written to tmp-component-usage.json');

process.exit(0);
