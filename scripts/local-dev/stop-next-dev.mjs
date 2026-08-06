#!/usr/bin/env node

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const lockPath = path.join(process.cwd(), ".next", "dev", "lock");

function removeLock() {
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandFor(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

if (!existsSync(lockPath)) {
  process.exit(0);
}

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, "utf8"));
} catch {
  removeLock();
  process.exit(0);
}

const pid = Number(lock.pid);
if (!Number.isInteger(pid) || pid <= 0) {
  removeLock();
  process.exit(0);
}

if (!isAlive(pid)) {
  removeLock();
  process.exit(0);
}

const command = commandFor(pid);
if (!/next-server|next dev|next\/dist\/bin\/next/.test(command)) {
  throw new Error(
    `Refusing to stop PID ${pid}; command does not look like Next dev: ${command}`,
  );
}

console.log(
  `[next-dev] stopping existing repo dev server PID ${pid}: ${command}`,
);
process.kill(pid, "SIGTERM");

const deadline = Date.now() + 5_000;
while (Date.now() < deadline) {
  if (!isAlive(pid)) {
    removeLock();
    process.exit(0);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
}

if (isAlive(pid)) {
  process.kill(pid, "SIGKILL");
}

removeLock();
