#!/usr/bin/env node
// Future explicit creation of one ephemeral local credential; never prints it.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { BINDING, REPO, requireLiveBinding } from "./linux-binding.mjs";
const os = createRequire(import.meta.url)("./linux-platform.cjs");
requireLiveBinding();
if (process.argv[2] !== "--create-owned-local-password") os.deny();
process.env.CSF_ISOLATED_WORK_DIR = BINDING.workDir;
const dv = await import(
    pathToFileURL(path.join(REPO, "scripts/local-dev/dv-local-env.mjs"))
  ),
  marker = dv.inspectCsfIsolatedWorkDir(BINDING.workDir);
dv.getCsfIsolatedSupabaseEnv();
if (
  marker.runId !== BINDING.runId ||
  marker.projectId !== BINDING.projectId ||
  marker.databaseVolume !== BINDING.databaseVolume
)
  os.deny();
os.privateDir(marker.workDir);
const target = path.join(marker.workDir, "csf-local-test-password"),
  fd = fs.openSync(
    target,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
try {
  const s = fs.fstatSync(fd);
  if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600)
    os.deny();
  fs.writeFileSync(fd, randomBytes(24).toString("base64url") + "Aa1!\n");
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
process.stdout.write(
  JSON.stringify({
    passwordFile: target,
    valuePrinted: false,
    fixtureWrites: 0,
  }) + "\n",
);
