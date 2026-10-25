"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const REPO = require("./linux-binding.cjs").load().repoRoot;
const BUILD_DIST_DIR = ".next-csf-isolated/browser-app";
const BUILD_ARTIFACTS = [
  "BUILD_ID",
  "build-manifest.json",
  "routes-manifest.json",
  "required-server-files.json",
  "server/app-paths-manifest.json",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
  throw new Error(message);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function routeSafe(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    fail("Invalid local route");
  const u = new URL(value, "http://127.0.0.1:3000");
  const checkedPath = decodeURIComponent(u.pathname);
  if (checkedPath.includes("\\") || /%[a-f0-9]{2}/iu.test(checkedPath))
    fail("Ambiguous encoded route refused");
  if (
    /^\/(?:logout|guardian-action)(?:\/|$)/u.test(checkedPath) ||
    /^\/anonymous(?:\/|$)/u.test(checkedPath) ||
    /^\/attend\/.+\/prepare\/?$/u.test(checkedPath) ||
    /^\/organization\/join(?:\/|$)/u.test(checkedPath) ||
    /^\/(?:feedback|reset-password)\/.+/u.test(checkedPath) ||
    /^\/api\/(?:cron|auth\/google|.*worker)/u.test(checkedPath)
  )
    fail("Action-on-visit/provider/token route refused");
  if (
    /^\/auth\/(?:callback|confirm)(?:\/|$)/u.test(checkedPath) ||
    /^\/api\/(?:google|calendar\/google|dev|admin\/moderation\/scan-stream|account\/data-export\/download)(?:\/|$)/u.test(
      checkedPath,
    ) ||
    /^\/rest\/v1\/rpc(?:\/|$)/u.test(checkedPath)
  )
    fail("Unreviewed GET effect/provider/RPC route refused");
  if (
    [...u.searchParams.keys()].some((k) =>
      /token|challenge|secret|code/i.test(k),
    )
  )
    fail("Tokenized routes require a separate reviewed fixture journey");
  return u;
}

function verifyStaticImageProof(repo, proof, trackedPaths) {
  if (
    proof.schema !== "lets-assist-static-image-proof-v1" ||
    proof.sourceOnly !== true ||
    proof.repoRoot !== repo ||
    !Array.isArray(proof.assets) ||
    !proof.assets.length
  )
    fail("Frozen exact static-image proof required");
  const images = new Map(),
    tracked = new Set(trackedPaths);
  for (const asset of proof.assets) {
    if (
      typeof asset.route !== "string" ||
      !/^\/[a-zA-Z0-9._/-]+$/u.test(asset.route) ||
      asset.route.includes("//") ||
      asset.route.split("/").some((p) => p === "." || p === "..") ||
      asset.sourceFile !== `public${asset.route}` ||
      !tracked.has(asset.sourceFile) ||
      !SHA256.test(asset.sha256) ||
      images.has(asset.route)
    )
      fail("Untracked, ambiguous or duplicate image path refused");
    const target = path.join(repo, asset.sourceFile);
    if (fs.realpathSync(target) !== target) fail("Image path symlink refused");
    const st = fs.lstatSync(target);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid() ||
      digest(fs.readFileSync(target)) !== asset.sha256
    )
      fail("Frozen static-image bytes mismatch");
    images.set(asset.route, { target, sha256: asset.sha256 });
  }
  const routingFiles = ["next.config.ts", "proxy.ts"];
  if (
    !proof.routingSourceHashes ||
    Object.keys(proof.routingSourceHashes).sort().join("\n") !==
      routingFiles.sort().join("\n")
  )
    fail("Exact static routing source identity required");
  for (const file of routingFiles)
    if (
      digest(fs.readFileSync(path.join(repo, file))) !==
      proof.routingSourceHashes[file]
    )
      fail("Reviewed static routing source changed");
  return images;
}
let defaultImages;
function exactStaticImages() {
  if (!defaultImages) {
    const file = path.join(
        __dirname,
        "proof-data/static-image-source-proof.json",
      ),
      st = fs.lstatSync(file);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid() ||
      st.mode & 0o077
    )
      fail("Owned frozen image proof required");
    const tracked = execFileSync(
      "/usr/bin/git",
      ["ls-files", "-z", "--", "public"],
      { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString()
      .split("\0")
      .filter(Boolean);
    defaultImages = verifyStaticImageProof(
      REPO,
      JSON.parse(fs.readFileSync(file)),
      tracked,
    );
  }
  return defaultImages;
}
function staticImageTargetSafe(image, images) {
  if (typeof image !== "string" || !images.has(image))
    fail("Image optimizer target is not a frozen static public asset");
  const asset = images.get(image),
    st = fs.lstatSync(asset.target);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    fs.realpathSync(asset.target) !== asset.target ||
    st.uid !== process.getuid() ||
    digest(fs.readFileSync(asset.target)) !== asset.sha256
  )
    fail("Static image changed after proof");
  return true;
}

function localRequestSafe(value, baseURL, supabaseOrigin, images) {
  const u = new URL(value);
  if (![baseURL, supabaseOrigin].includes(u.origin) || u.username || u.password)
    fail("Unexpected request origin or credentials");
  routeSafe(u.pathname + u.search);
  // A same-origin image optimizer can proxy a forbidden remote image.
  if (decodeURIComponent(u.pathname).replace(/\/$/u, "") === "/_next/image") {
    if (
      u.pathname !== "/_next/image" ||
      u.origin !== baseURL ||
      [...u.searchParams.keys()].sort().join("\n") !== "q\nurl\nw" ||
      !/^[0-9]{1,4}$/u.test(u.searchParams.get("w") ?? "") ||
      !/^[0-9]{1,3}$/u.test(u.searchParams.get("q") ?? "")
    )
      fail("Unreviewed image optimizer query refused");
    if (
      Number(u.searchParams.get("w")) < 1 ||
      Number(u.searchParams.get("q")) < 1 ||
      Number(u.searchParams.get("q")) > 100
    )
      fail("Invalid image dimensions/quality refused");
    staticImageTargetSafe(
      u.searchParams.get("url"),
      images ?? exactStaticImages(),
    );
  }
  return u;
}

function exactCompiledBuild(repo, manifest) {
  if (manifest.buildDistDir !== BUILD_DIST_DIR)
    fail("Canonical isolated browser build directory required");
  const directory = path.join(repo, BUILD_DIST_DIR);
  for (const part of [path.join(repo, ".next-csf-isolated"), directory]) {
    const st = fs.lstatSync(part);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid())
      fail("Owned nonsymlink canonical build directory required");
  }
  if (fs.realpathSync(directory) !== directory)
    fail("Canonical compiled directory mismatch");
  const hashes = manifest.buildArtifactHashes;
  if (
    !hashes ||
    Object.keys(hashes).sort().join("\n") !==
      [...BUILD_ARTIFACTS].sort().join("\n")
  )
    fail("Exact build artifact hash set required");
  for (const file of BUILD_ARTIFACTS) {
    const target = path.join(directory, file);
    const parent = path.dirname(target);
    if (fs.realpathSync(parent) !== parent)
      fail("Build artifact parent symlink refused");
    const st = fs.lstatSync(target);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid() ||
      !SHA256.test(hashes[file]) ||
      digest(fs.readFileSync(target)) !== hashes[file]
    )
      fail("Compiled artifact hash mismatch");
  }
  const buildId = fs
    .readFileSync(path.join(directory, "BUILD_ID"), "utf8")
    .trim();
  if (
    typeof manifest.buildId !== "string" ||
    !manifest.buildId ||
    buildId !== manifest.buildId
  )
    fail("Compiled build identity mismatch");
  const required = JSON.parse(
    fs.readFileSync(path.join(directory, "required-server-files.json"), "utf8"),
  );
  if (required.config?.distDir !== BUILD_DIST_DIR)
    fail("Compiled config distDir mismatch");
  return directory;
}

function baselineContracts(seedAccounts) {
  return seedAccounts.map((a) => ({
    key: a.key,
    email: a.email,
    fullName: a.fullName,
    username: a.email.split("@")[0].replaceAll(".", "-"),
    avatarUrl: a.avatarUrl ?? null,
    superAdmin: !!a.superAdmin,
    authRole: "authenticated",
    authPhone: null,
    profilePhone: null,
    appRole: a.superAdmin ? "super_admin" : null,
  }));
}

function hoursContract(n, marker) {
  if (!Number.isInteger(n) || n < 1 || n > 1110)
    fail("Unknown retained Hours ordinal");
  return {
    id: `c8a61100-0001-4000-8000-${String(n).padStart(12, "0")}`,
    email: `hours-acceptance-c8a61100-${n}@local.lets-assist.test`,
    username: `ha_c8a61100_${n}`,
    fullName: `Fictional hours volunteer ${n}`,
    profileFullName: "Fictional hours volunteer",
    avatarUrl: null,
    authRole: "authenticated",
    authPhone: null,
    profilePhone: null,
    appRole: null,
    metadata: {
      local_fixture: true,
      local_fixture_namespace: "hours-acceptance-c8a61100",
      local_fixture_run_id: marker.runId,
      local_fixture_project_id: marker.projectId,
    },
  };
}

function proofContracts(proof, marker, seedAccounts, hoursSqlSha256) {
  if (
    proof.template === true ||
    proof.schema !== "lets-assist-layout-fixture-proof-v2" ||
    proof.syntheticOnly !== true ||
    proof.runId !== marker.runId ||
    proof.projectId !== marker.projectId ||
    proof.seedMode !== "csf-isolated-v1"
  )
    fail("Exact run/project fixture proof required");
  const expected = baselineContracts(seedAccounts);
  if (
    !Array.isArray(proof.baselineActors) ||
    proof.baselineActors.length !== expected.length
  )
    fail("Exact baseline actor set required");
  const contracts = [];
  for (const a of expected) {
    const rows = proof.baselineActors.filter((r) => r.key === a.key);
    if (rows.length !== 1 || !UUID.test(rows[0].userId))
      fail("Exact seeded Auth UUID proof required");
    const row = rows[0];
    if (
      row.email !== a.email ||
      row.fullName !== a.fullName ||
      row.username !== a.username ||
      row.avatarUrl !== a.avatarUrl ||
      row.superAdmin !== a.superAdmin ||
      row.authRole !== a.authRole ||
      row.authPhone !== null ||
      row.profilePhone !== null ||
      row.appRole !== a.appRole
    )
      fail("Baseline source identity mismatch");
    contracts.push({
      ...a,
      id: row.userId,
      metadata: { local_fixture: true },
      kind: "baseline",
    });
  }
  if (![0, 1110].includes(proof.retainedHoursCount))
    fail("Hours corpus must be absent or the complete retained exact set");
  if (proof.retainedHoursCount === 1110) {
    if (
      proof.hoursNamespace !== "hours-acceptance-c8a61100" ||
      !SHA256.test(hoursSqlSha256 ?? "") ||
      proof.hoursIdentityProofSqlSha256 !== hoursSqlSha256 ||
      proof.hoursIdentityProofBinding?.runId !== marker.runId ||
      proof.hoursIdentityProofBinding?.projectId !== marker.projectId
    )
      fail("Exact Hours namespace/query binding receipt required");
    const actual = proof.hoursIdentityProof;
    const fields = {
      proofVersion: 1,
      namespace: "hours-acceptance-c8a61100",
      exactMarkerBinding: true,
      expectedIdentityCount: 1110,
      scopedAuthCount: 1110,
      matchedAuthCount: 1110,
      authMappingViolations: 0,
      scopedProfileCount: 1110,
      matchedProfileCount: 1110,
      profileMappingViolations: 0,
      proofValid: true,
    };
    for (const [key, value] of Object.entries(fields))
      if (actual?.[key] !== value)
        fail("Retained Hours SQL proof is not valid");
    for (let n = 1; n <= 1110; n++)
      contracts.push({ ...hoursContract(n, marker), kind: "hours" });
  }
  // Extra test actors must be prepared in a separately reviewed exact proof; this
  // baseline capture contract never accepts a domain/suffix or unknown identity.
  if (
    new Set(contracts.map((a) => a.id)).size !== contracts.length ||
    new Set(contracts.map((a) => a.email)).size !== contracts.length
  )
    fail("Duplicate fixture identity");
  return contracts;
}

function verifyFixtureRows(contracts, users, profiles) {
  if (users.length !== contracts.length || profiles.length !== contracts.length)
    fail("Auth/profile corpus differs from exact fictional fixture set");
  const expected = new Map(contracts.map((a) => [a.id, a]));
  const seenUsers = new Set(),
    seenProfiles = new Set();
  for (const u of users) {
    const a = expected.get(u.id);
    if (
      !a ||
      seenUsers.has(u.id) ||
      u.email !== a.email ||
      u.user_metadata?.full_name !== a.fullName ||
      u.user_metadata?.username !== a.username ||
      (u.user_metadata?.avatar_url ?? null) !== a.avatarUrl
    )
      fail("Unrecognized Auth fixture identity");
    for (const [k, v] of Object.entries(a.metadata))
      if (u.user_metadata?.[k] !== v)
        fail("Auth fixture ownership metadata mismatch");
    if (
      u.role !== a.authRole ||
      u.aud !== "authenticated" ||
      ![null, ""].includes(u.phone)
    )
      fail("Auth fixture role/phone mismatch");
    if (
      u.user_metadata?.phone != null ||
      u.user_metadata?.phone_number != null ||
      u.user_metadata?.role != null ||
      u.user_metadata?.is_super_admin != null
    )
      fail("Unseeded identity claims refused");
    const app = u.app_metadata;
    if (!app || typeof app !== "object" || Array.isArray(app))
      fail("Exact fixture app metadata required");
    const allowedAppKeys =
      a.kind === "hours"
        ? Object.keys(a.metadata)
        : a.superAdmin
          ? ["provider", "providers", "role", "is_super_admin", "local_fixture"]
          : ["provider", "providers"];
    if (Object.keys(app).some((k) => !allowedAppKeys.includes(k)))
      fail("Unseeded role/identity metadata refused");
    if (Object.hasOwn(app, "provider") && app.provider !== "email")
      fail("Unexpected Auth provider refused");
    if (
      Object.hasOwn(app, "providers") &&
      (!Array.isArray(app.providers) ||
        app.providers.length !== 1 ||
        app.providers[0] !== "email")
    )
      fail("Unexpected Auth providers refused");
    if (a.kind === "hours")
      for (const [k, v] of Object.entries(a.metadata))
        if (u.app_metadata?.[k] !== v)
          fail("Hours owner-authored metadata mismatch");
    if (
      a.superAdmin &&
      (u.app_metadata?.role !== "super_admin" ||
        u.app_metadata?.is_super_admin !== true ||
        u.app_metadata?.local_fixture !== true)
    )
      fail("Super-admin fixture metadata mismatch");
    seenUsers.add(u.id);
  }
  for (const p of profiles) {
    const a = expected.get(p.id);
    if (
      !a ||
      seenProfiles.has(p.id) ||
      p.email !== a.email ||
      p.username !== a.username ||
      p.full_name !== (a.profileFullName ?? a.fullName) ||
      (p.avatar_url ?? null) !== a.avatarUrl ||
      p.phone !== a.profilePhone
    )
      fail("Unrecognized public profile fixture identity");
    seenProfiles.add(p.id);
  }
  return {
    authUsers: seenUsers.size,
    publicProfiles: seenProfiles.size,
    exactIdentityProof: true,
  };
}

module.exports = {
  REPO,
  BUILD_DIST_DIR,
  BUILD_ARTIFACTS,
  digest,
  fail,
  UUID,
  SHA256,
  routeSafe,
  verifyStaticImageProof,
  exactStaticImages,
  staticImageTargetSafe,
  localRequestSafe,
  exactCompiledBuild,
  baselineContracts,
  hoursContract,
  proofContracts,
  verifyFixtureRows,
};
