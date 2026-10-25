"use strict";
// Real Linux observations are lazy. Pure parsers are exercised offline.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  cp = require("node:child_process");
const deny = () => {
  throw Error("Owned Linux capture proof refused; private details omitted");
};
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const SHA = /^[a-f0-9]{64}$/u,
  UID = () => process.getuid();
function canonical(p) {
  if (typeof p !== "string" || !path.isAbsolute(p) || fs.realpathSync(p) !== p)
    deny();
  return p;
}
function ownFile(p, privateMode = true) {
  canonical(p);
  const s = fs.lstatSync(p);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== UID() ||
    (privateMode && s.mode & 0o077)
  )
    deny();
  return s;
}
function privateDir(p, empty = false) {
  canonical(p);
  const s = fs.lstatSync(p);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== UID() ||
    s.mode & 0o077 ||
    (empty && fs.readdirSync(p).length)
  )
    deny();
  return p;
}
function readJSON(p) {
  ownFile(p);
  return JSON.parse(fs.readFileSync(p));
}
function exclusiveJSON(p, value) {
  canonical(path.dirname(p));
  const epoch = Date.now(),
    fd = fs.openSync(
      p,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.uid !== UID() || s.mode & 0o077) deny();
    const result = {
      ...value,
      createdAtEpochMs: epoch,
      creationProof: {
        mechanism: "exclusive-fsync-inode-v1",
        dev: s.dev,
        ino: s.ino,
        uid: s.uid,
        mode: s.mode & 0o777,
      },
    };
    fs.writeFileSync(fd, JSON.stringify(result) + "\n");
    fs.fsyncSync(fd);
    const dir = fs.openSync(path.dirname(p), fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
    return result;
  } finally {
    fs.closeSync(fd);
  }
}
function readCreatedJSON(p, sha) {
  ownFile(p);
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd),
      bytes = fs.readFileSync(fd);
    if (sha && (!SHA.test(sha) || hash(bytes) !== sha)) deny();
    const v = JSON.parse(bytes),
      c = v.creationProof;
    if (
      c?.mechanism !== "exclusive-fsync-inode-v1" ||
      c.dev !== s.dev ||
      c.ino !== s.ino ||
      c.uid !== UID() ||
      c.mode !== 0o600 ||
      (s.mode & 0o777) !== 0o600 ||
      !Number.isFinite(v.createdAtEpochMs) ||
      v.createdAtEpochMs <= 0 ||
      v.createdAtEpochMs > Date.now() + 1000
    )
      deny();
    return v;
  } finally {
    fs.closeSync(fd);
  }
}
function safeRelative(p) {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    p
      .split("/")
      .every(
        (c) =>
          c && c !== "." && c !== ".." && /^[a-zA-Z0-9._@[\]()-]+$/u.test(c),
      )
  );
}
function freezeFiles(dir, cacheEntry) {
  canonical(dir);
  const root = fs.lstatSync(dir);
  if (!root.isDirectory() || root.uid !== UID() || root.isSymbolicLink())
    deny();
  const rows = {};
  function visit(base, relative) {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      const f = path.join(base, e.name),
        rel = relative ? relative + "/" + e.name : e.name,
        s = fs.lstatSync(f);
      if (s.isSymbolicLink() || s.uid !== UID()) deny();
      const cache = cacheEntry ? cacheEntry(dir, rel, s) : false;
      if (!cache && !safeRelative(rel)) deny();
      if (s.isDirectory()) visit(f, rel);
      else if (s.isFile()) {
        if (!cache) rows[rel] = hash(fs.readFileSync(f));
      } else deny();
    }
  }
  visit(dir, "");
  return Object.fromEntries(
    Object.keys(rows)
      .sort()
      .map((k) => [k, rows[k]]),
  );
}
function parseStat(text, pid) {
  const close = text.lastIndexOf(")"),
    open = text.indexOf("(");
  if (open < 1 || close <= open || Number(text.slice(0, open).trim()) !== pid)
    deny();
  const s = text
    .slice(close + 1)
    .trim()
    .split(/\s+/u);
  if (s.length < 20 || !/^\d+$/u.test(s[1]) || !/^\d+$/u.test(s[19])) deny();
  const ppid = Number(s[1]);
  if (!Number.isSafeInteger(ppid) || ppid < 0) deny();
  return { pid, parentPid: ppid, startTicks: s[19] };
}
function parseStatus(text, uid) {
  const matches = [
    ...text.matchAll(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/gmu),
  ];
  if (
    matches.length !== 1 ||
    matches[0].slice(1).some((n) => Number(n) !== uid)
  )
    deny();
  return true;
}
function nulVector(bytes) {
  const text = bytes.toString("utf8");
  if (!text.endsWith("\0") || text.includes("\ufffd")) deny();
  return text.slice(0, -1).split("\0").filter(Boolean);
}
function selectedEnv(bytes, names) {
  const wanted = new Set(names),
    out = {};
  for (const entry of nulVector(bytes)) {
    const i = entry.indexOf("=");
    if (i < 1) deny();
    const k = entry.slice(0, i);
    if (wanted.has(k)) {
      if (Object.hasOwn(out, k)) deny();
      out[k] = entry.slice(i + 1);
    }
  }
  return out;
}
function tcpRows(text, port) {
  const lines = text.trim().split("\n");
  if (!lines[0]?.includes("local_address")) deny();
  const out = [];
  for (const line of lines.slice(1)) {
    const p = line.trim().split(/\s+/u);
    if (p.length < 10 || !p[1].includes(":")) deny();
    const [host, hex] = p[1].split(":");
    if (!/^[a-f0-9]+$/iu.test(host) || !/^[a-f0-9]{4}$/iu.test(hex)) deny();
    if (parseInt(hex, 16) === port && p[3] === "0A") {
      if (!/^\d+$/u.test(p[7]) || !/^\d+$/u.test(p[9])) deny();
      out.push({
        host: host.toUpperCase(),
        port,
        uid: Number(p[7]),
        inode: p[9],
      });
    }
  }
  return out;
}
function linux() {
  if (process.platform !== "linux") deny();
}
function kernelClock() {
  linux();
  const bootId = fs
    .readFileSync("/proc/sys/kernel/random/boot_id", "utf8")
    .trim();
  if (!/^[a-f0-9-]{36}$/u.test(bootId)) deny();
  const b = fs.readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/mu);
  if (!b) deny();
  let ticks;
  try {
    ticks = Number(
      cp.execFileSync("/usr/bin/getconf", ["CLK_TCK"], {
        env: { PATH: "/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    deny();
  }
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 100000) deny();
  return { bootId, bootEpochSeconds: Number(b[1]), ticksPerSecond: ticks };
}
function identity(pid) {
  linux();
  if (!Number.isInteger(pid) || pid < 2) deny();
  const base = "/proc/" + pid,
    s = fs.statSync(base);
  if (s.uid !== UID()) deny();
  parseStatus(fs.readFileSync(base + "/status", "utf8"), UID());
  const stat = parseStat(fs.readFileSync(base + "/stat", "utf8"), pid),
    clock = kernelClock(),
    cwd = fs.readlinkSync(base + "/cwd"),
    executable = fs.readlinkSync(base + "/exe");
  if (
    !path.isAbsolute(cwd) ||
    !path.isAbsolute(executable) ||
    executable.endsWith(" (deleted)")
  )
    deny();
  const out = {
    ...stat,
    uid: UID(),
    cwd,
    executable,
    bootId: clock.bootId,
    startIdentity: clock.bootId + ":" + pid + ":" + stat.startTicks,
    startedAtEpochMs:
      clock.bootEpochSeconds * 1000 +
      (Number(stat.startTicks) * 1000) / clock.ticksPerSecond,
    startClockPrecisionMs: 1000,
  };
  const again = parseStat(fs.readFileSync(base + "/stat", "utf8"), pid);
  if (again.startTicks !== stat.startTicks || fs.statSync(base).uid !== UID())
    deny();
  return out;
}
function sameIdentity(a, b) {
  if (
    !a ||
    !b ||
    [
      "pid",
      "uid",
      "cwd",
      "executable",
      "bootId",
      "startIdentity",
      "startTicks",
      "startedAtEpochMs",
    ].some((k) => a[k] !== b[k])
  )
    deny();
  return true;
}
function processValues(proof, names) {
  const before = identity(proof.pid);
  sameIdentity(before, proof);
  const base = "/proc/" + proof.pid,
    argv = nulVector(fs.readFileSync(base + "/cmdline")),
    env = selectedEnv(fs.readFileSync(base + "/environ"), names);
  sameIdentity(before, identity(proof.pid));
  return { argv, env };
}
function listeners(port) {
  linux();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) deny();
  return [
    ...tcpRows(fs.readFileSync("/proc/net/tcp", "utf8"), port),
    ...tcpRows(fs.readFileSync("/proc/net/tcp6", "utf8"), port),
  ];
}
function assertPortFree(port) {
  if (listeners(port).length) deny();
  return true;
}
function verifiedSocket(rows, uid, fdLinks) {
  if (
    rows.length !== 1 ||
    rows[0].host !== "0100007F" ||
    rows[0].uid !== uid ||
    !fdLinks.includes("socket:[" + rows[0].inode + "]")
  )
    deny();
  return rows[0].inode;
}
function assertListener(proof, port) {
  const before = identity(proof.pid);
  sameIdentity(before, proof);
  const rows = listeners(port),
    links = [];
  for (const fd of fs.readdirSync("/proc/" + proof.pid + "/fd")) {
    try {
      links.push(fs.readlinkSync("/proc/" + proof.pid + "/fd/" + fd));
    } catch (e) {
      if (e.code !== "ENOENT") deny();
    }
  }
  const inode = verifiedSocket(rows, UID(), links);
  sameIdentity(before, identity(proof.pid));
  return inode;
}
function codeManifest(directory, expected) {
  canonical(directory);
  const file = path.join(directory, "code-manifest.sha256");
  ownFile(file);
  const bytes = fs.readFileSync(file);
  if (!SHA.test(expected ?? "") || hash(bytes) !== expected) deny();
  const names = new Set();
  for (const line of bytes.toString().trim().split("\n")) {
    const m = line.match(/^([a-f0-9]{64}) {2}(.+)$/u);
    if (!m || !safeRelative(m[2]) || names.has(m[2])) deny();
    names.add(m[2]);
    const target = path.join(directory, m[2]);
    ownFile(target);
    if (hash(fs.readFileSync(target)) !== m[1]) deny();
  }
  for (const n of [
    "linux-platform.cjs",
    "linux-binding.cjs",
    "capture.mjs",
    "linux-spawn-observer.cjs",
    "collect-fixture-proof.mjs",
    "collect-runtime-proof.mjs",
  ])
    if (!names.has(n)) deny();
  for (const n of fs
    .readdirSync(directory)
    .filter((n) => /\.(?:mjs|cjs|js)$/u.test(n)))
    if (!names.has(n)) deny();
  return expected;
}
function sourceIdentity(repo, expected) {
  canonical(repo);
  const git = (r, args) =>
      cp
        .execFileSync("/usr/bin/git", args, {
          cwd: r,
          env: { PATH: "/usr/bin:/bin" },
          stdio: ["ignore", "pipe", "ignore"],
        })
        .toString()
        .trim(),
    priv = path.join(repo, "lib/plugins/private");
  canonical(priv);
  const actual = {
    rootHead: git(repo, ["rev-parse", "HEAD"]),
    privateHead: git(priv, ["rev-parse", "HEAD"]),
    dirtyDiffSha256: hash(Buffer.from("\n--private--\n")),
  };
  if (
    git(repo, ["diff", "--binary", "HEAD"]) ||
    git(priv, ["diff", "--binary", "HEAD"]) ||
    git(repo, ["ls-files", "--others", "--exclude-standard"]) ||
    git(priv, ["ls-files", "--others", "--exclude-standard"]) ||
    git(repo, ["rev-parse", "HEAD:lib/plugins/private"]) !== actual.privateHead
  )
    deny();
  if (
    expected &&
    ["rootHead", "privateHead", "dirtyDiffSha256"].some(
      (k) => expected[k] !== actual[k],
    )
  )
    deny();
  return actual;
}
module.exports = {
  deny,
  hash,
  SHA,
  canonical,
  ownFile,
  privateDir,
  readJSON,
  exclusiveJSON,
  readCreatedJSON,
  safeRelative,
  freezeFiles,
  parseStat,
  parseStatus,
  nulVector,
  selectedEnv,
  tcpRows,
  identity,
  sameIdentity,
  processValues,
  verifiedSocket,
  assertPortFree,
  assertListener,
  codeManifest,
  sourceIdentity,
};
