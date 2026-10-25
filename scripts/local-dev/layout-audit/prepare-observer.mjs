import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { BINDING, REPO, requireLiveBinding } from "./linux-binding.mjs";
const require = createRequire(import.meta.url),
  os = require("./linux-platform.cjs");
requireLiveBinding();
if (process.argv[2] !== "--enable-observer") os.deny();
const [name, optFile] = process.argv.slice(3);
if (!name || !optFile || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/u.test(name))
  os.deny();
const parent = path.join(REPO, ".artifacts/layout-audit-spawn");
for (const p of [path.join(REPO, ".artifacts"), parent]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { mode: 0o700 });
  os.canonical(p);
  const s = fs.lstatSync(p);
  if (!s.isDirectory() || s.uid !== process.getuid()) os.deny();
}
const outputDir = path.join(parent, name);
fs.mkdirSync(outputDir, { mode: 0o700 });
require("./linux-spawn-observer.cjs").freshOutput(REPO, outputDir);
os.privateDir(path.dirname(optFile));
const self = fs.realpathSync(
  new URL("./capture-spawn-observer.cjs", import.meta.url).pathname,
);
const value = require("./linux-spawn-observer.cjs").makeObserverOptIn(
  BINDING,
  { path: self, sha256: os.hash(fs.readFileSync(self)) },
  outputDir,
);
os.exclusiveJSON(optFile, value);
process.stdout.write(
  JSON.stringify({
    optInFile: optFile,
    optInSha256: os.hash(fs.readFileSync(optFile)),
    observer: self,
    outputDir,
    fixtureWrites: 0,
    serverStarts: 0,
  }) + "\n",
);
