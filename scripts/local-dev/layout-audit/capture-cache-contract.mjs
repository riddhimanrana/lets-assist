// Exact source-proved non-code cache exceptions; compiled code stays frozen.
import fs from "node:fs";
import path from "node:path";
import { REPO, SHA256, digest, fail, routeSafe } from "./capture-contract.mjs";
const PROOF = new URL(
  "./proof-data/runtime-cache-source-proof.json",
  import.meta.url,
);
const SOURCE_PATHS = [
  "node_modules/next/dist/server/image-optimizer.js",
  "node_modules/next/dist/server/image-optimizer/extract-etag.js",
  "node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js",
  "node_modules/next/dist/server/lib/incremental-cache/index.js",
  "node_modules/next/dist/server/lib/route-cache-key.js",
  "node_modules/next/dist/lib/multi-file-writer.js",
  "node_modules/next/dist/server/lib/node-fs-methods.js",
  "node_modules/next/dist/shared/lib/router/utils/app-paths.js",
  "node_modules/next/dist/shared/lib/page-path/normalize-page-path.js",
  "node_modules/next/dist/server/web/spec-extension/unstable-cache.js",
  "lib/home/landing-demo-mode.ts",
];
const JSON_OBJECT = (v) => v && typeof v === "object" && !Array.isArray(v);
const relativeSafe = (s) =>
  typeof s === "string" &&
  !s.startsWith("/") &&
  !s.includes("//") &&
  !s.split("/").some((p) => p === "." || p === "..");
export function exactRuntimeCacheSources() {
  const st = fs.lstatSync(PROOF);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    st.mode & 0o077
  )
    fail("Owned cache source proof required");
  const bytes = fs.readFileSync(PROOF),
    p = JSON.parse(bytes);
  if (
    p.schema !== "lets-assist-runtime-cache-source-proof-v1" ||
    p.sourceOnly !== true ||
    p.repoRoot !== REPO ||
    p.nextVersion !== "16.4.0" ||
    JSON.stringify(p.namespaces) !==
      JSON.stringify([
        "cache/images",
        "cache/fetch-cache",
        "server/route-cache",
      ]) ||
    !Array.isArray(p.files) ||
    p.files.map((f) => f.repoRelativePath).join("\n") !==
      SOURCE_PATHS.join("\n")
  )
    fail("Exact reviewed cache source proof required");
  for (const f of p.files) {
    const target = path.join(REPO, f.repoRelativePath),
      real = fs.realpathSync(target),
      s = fs.lstatSync(real);
    if (
      !relativeSafe(f.repoRelativePath) ||
      real !== f.realpath ||
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid() ||
      !SHA256.test(f.sha256) ||
      digest(fs.readFileSync(real)) !== f.sha256
    )
      fail("Reviewed runtime cache source drifted");
  }
  return digest(bytes);
}
const normalizedSource = (source) =>
  "/" +
  source
    .split("/")
    .filter(
      (s, i, a) =>
        s &&
        !/^\(.*\)$/u.test(s) &&
        !s.startsWith("@") &&
        !(i === a.length - 1 && s === "page"),
    )
    .join("/")
    .replace(/%5F/gu, "_");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
function sourcePattern(source) {
  const segments = normalizedSource(source).split("/").filter(Boolean);
  return new RegExp(
    "^" +
      segments
        .map((s) =>
          /^\[\[\.\.\..+\]\]$/u.test(s)
            ? "(?:/[^/]+)*"
            : /^\[\.\.\..+\]$/u.test(s)
              ? "/[^/]+(?:/[^/]+)*"
              : /^\[.+\]$/u.test(s)
                ? "/[^/]+"
                : "/" + escape(s),
        )
        .join("") +
      "/?$",
    "u",
  );
}
const normalizePage = (p) =>
  p === "/" ? "/index" : /^\/index(?:\/|$)/u.test(p) ? "/index" + p : p;
export function cachePolicyFromCompiled(
  appPaths,
  selectedPaths,
  hash,
  sourceProofSha256,
) {
  if (
    !JSON_OBJECT(appPaths) ||
    !Array.isArray(selectedPaths) ||
    !selectedPaths.length ||
    !SHA256.test(hash) ||
    !SHA256.test(sourceProofSha256)
  )
    fail("Frozen compiled routes and selected capture paths required");
  const paths = [...new Set(selectedPaths)].sort();
  const routes = new Map();
  for (const selected of paths) {
    const u = routeSafe(selected);
    if (u.search || u.hash || u.pathname !== selected)
      fail("Canonical query-free selected cache route required");
    const matches = Object.entries(appPaths).filter(
      ([source, worker]) =>
        source.endsWith("/page") &&
        typeof worker === "string" &&
        worker.startsWith("app/") &&
        worker.endsWith(".js") &&
        sourcePattern(source).test(selected),
    );
    if (matches.length !== 1)
      fail("Selected cache route lacks one positive compiled source owner");
    const [sourceRoute, worker] = matches[0];
    if (!relativeSafe(worker)) fail("Compiled page worker path refused");
    const hash = digest(Buffer.from(sourceRoute));
    routes.set(
      `server/route-cache/APP_PAGE/${hash}/$${normalizePage(selected)}`,
      { sourceRoute, selected, worker },
    );
  }
  return {
    sourceProofSha256,
    appPathsManifestSha256: hash,
    selectedPaths: paths,
    routes,
  };
}
export function runtimeCachePolicy(
  directory,
  policy,
  selectedPaths,
  expected,
  compiledHashes,
) {
  const proof = exactRuntimeCacheSources(),
    file = path.join(directory, "server/app-paths-manifest.json");
  if (
    !policy ||
    policy.enabled !== true ||
    policy.sourceProofSha256 !== proof ||
    JSON.stringify(policy.selectedPaths) !==
      JSON.stringify([...new Set(selectedPaths)].sort()) ||
    digest(fs.readFileSync(file)) !== policy.appPathsManifestSha256
  )
    fail("Exact reviewed source/compiled/selected-route cache policy required");
  const result = cachePolicyFromCompiled(
    JSON.parse(fs.readFileSync(file)),
    policy.selectedPaths,
    policy.appPathsManifestSha256,
    proof,
  );
  for (const entry of result.routes.values()) {
    const rel = "server/" + entry.worker,
      target = path.join(directory, rel),
      st = fs.lstatSync(target);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid() ||
      fs.realpathSync(target) !== target ||
      !SHA256.test(compiledHashes?.[rel] ?? "") ||
      digest(fs.readFileSync(target)) !== compiledHashes[rel]
    )
      fail("Positive cache route worker lacks frozen compiled bytes");
  }
  result.loopbackOrigins = [
    `http://127.0.0.1:${expected.appPort}`,
    `http://127.0.0.1:${expected.apiPort}`,
  ];
  return result;
}
function raster(bytes, ext) {
  if (ext === "png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === "webp")
    return (
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP"
    );
  if (["jpg", "jpeg"].includes(ext))
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (ext === "gif")
    return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  if (ext === "ico")
    return bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
  if (ext === "avif")
    return (
      bytes.subarray(4, 8).toString() === "ftyp" &&
      /avif|avis/u.test(bytes.subarray(8, 32).toString())
    );
  return false;
}
function payload(file, extension, entry, _base) {
  const bytes = fs.readFileSync(file);
  if (!bytes.length || bytes.length > 32 * 1024 * 1024)
    fail("Bounded nonempty response cache data required");
  const text = bytes.toString("utf8");
  if (extension === "html") {
    if (!/^\s*(?:<!doctype\s*html\b|<html\b)/iu.test(text))
      fail("Non-HTML cache payload refused");
    return;
  }
  if (extension === "rsc") {
    if (!/^[0-9a-f]+:/imu.test(text)) fail("Non-RSC cache payload refused");
    return;
  }
  if (extension === "json") {
    JSON.parse(text);
    return;
  }
  if (extension !== "meta") fail("Unreviewed cache payload extension refused");
  const meta = JSON.parse(text),
    keys = [
      "headers",
      "status",
      "postponed",
      "segmentPaths",
      "prefetchHints",
      "cacheControl",
      "routeCache",
      "routeCacheLastModified",
    ];
  if (
    !JSON_OBJECT(meta) ||
    Object.keys(meta).some((k) => !keys.includes(k)) ||
    !JSON_OBJECT(meta.headers ?? {}) ||
    (meta.status !== undefined &&
      (!Number.isInteger(meta.status) ||
        meta.status < 100 ||
        meta.status > 599))
  )
    fail("Unexpected response cache metadata refused");
  if (
    meta.routeCache?.owner &&
    (meta.routeCache.owner.kind !== "APP_PAGE" ||
      meta.routeCache.owner.sourceRoute !== entry.sourceRoute)
  )
    fail("Response cache metadata owner mismatch");
  if (
    meta.segmentPaths !== undefined &&
    (!Array.isArray(meta.segmentPaths) ||
      meta.segmentPaths.some(
        (p) =>
          typeof p !== "string" ||
          !p.startsWith("/") ||
          !relativeSafe(p.slice(1)),
      ))
  )
    fail("Unsafe response cache segment paths");
}
export function runtimeCacheEntrySafe(directory, rel, st, policy) {
  const file = path.join(directory, rel);
  const isImage = rel === "cache/images" || rel.startsWith("cache/images/"),
    isFetch =
      rel === "cache/fetch-cache" || rel.startsWith("cache/fetch-cache/"),
    isResponse =
      rel === "server/route-cache" || rel.startsWith("server/route-cache/");
  if (!isImage && !isFetch && !isResponse) return false;
  if (
    !policy ||
    !policy.routes ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid() ||
    fs.realpathSync(file) !== file ||
    (!st.isDirectory() && (!st.isFile() || st.mode & 0o111))
  )
    fail("Owned nonsymlink non-executable cache data required");
  if (isImage) {
    const sub = rel.slice("cache/images".length);
    if (st.isDirectory()) {
      if (sub && !/^\/[A-Za-z0-9_-]{43}$/u.test(sub))
        fail("Unknown image cache directory");
      return true;
    }
    const match =
      /^\/([A-Za-z0-9_-]{43})\/([0-9]{1,16})\.([0-9]{1,16})\.([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{1,512})\.(avif|webp|png|jpg|jpeg|gif|ico)$/u.exec(
        sub,
      );
    if (
      !match ||
      st.size > 32 * 1024 * 1024 ||
      !raster(fs.readFileSync(file), match[6])
    )
      fail("Non-raster/unexpected image cache data refused");
    return true;
  }
  if (isFetch) {
    const sub = rel.slice("cache/fetch-cache".length);
    if (st.isDirectory()) {
      if (sub) fail("Unexpected fetch cache directory");
      return true;
    }
    if (!/^\/[a-f0-9]{64}$/u.test(sub) || st.size > 32 * 1024 * 1024)
      fail("Unexpected fetch cache key/data");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      !JSON_OBJECT(data) ||
      data.kind !== "FETCH" ||
      Object.keys(data).some(
        (k) => !["kind", "data", "revalidate", "tags"].includes(k),
      ) ||
      !JSON_OBJECT(data.data) ||
      Object.keys(data.data).sort().join(",") !== "body,headers,status,url" ||
      typeof data.data.body !== "string" ||
      typeof data.data.url !== "string" ||
      !JSON_OBJECT(data.data.headers) ||
      !Number.isInteger(data.data.status) ||
      !Array.isArray(data.tags) ||
      data.tags.some((t) => typeof t !== "string") ||
      !(
        data.revalidate === false ||
        (Number.isFinite(data.revalidate) && data.revalidate > 0)
      )
    )
      fail("Non-FETCH JSON cache record refused");
    if (data.data.url) {
      let u;
      try {
        u = new URL(data.data.url);
      } catch {
        fail("Unreviewed fetch cache data URL");
      }
      if (
        !policy.loopbackOrigins?.includes(u.origin) ||
        u.username ||
        u.password
      )
        fail("Foreign fetch cache data refused");
    }
    return true;
  }
  const roots = [...policy.routes.keys()];
  if (st.isDirectory()) {
    if (roots.some((base) => base.startsWith(rel + "/"))) return true;
    for (const base of roots)
      if (rel === base + ".segments" || rel.startsWith(base + ".segments/")) {
        const meta = JSON.parse(
          fs.readFileSync(path.join(directory, base + ".meta"), "utf8"),
        );
        if (
          Array.isArray(meta.segmentPaths) &&
          meta.segmentPaths.some(
            (p) =>
              (base + ".segments" + p).startsWith(rel + "/") ||
              base + ".segments" + p === rel,
          )
        )
          return true;
      }
    fail("Unknown response cache kind/source hash/selected path");
  }
  const plain = roots.find((base) =>
    [".html", ".rsc", ".json", ".meta"].some((ext) => rel === base + ext),
  );
  if (plain) {
    payload(file, rel.slice(plain.length + 1), policy.routes.get(plain), plain);
    return true;
  }
  for (const base of roots)
    if (rel.startsWith(base + ".segments/") && rel.endsWith(".segment.rsc")) {
      const segment = rel.slice(
          (base + ".segments").length,
          -".segment.rsc".length,
        ),
        meta = JSON.parse(
          fs.readFileSync(path.join(directory, base + ".meta"), "utf8"),
        );
      if (
        !Array.isArray(meta.segmentPaths) ||
        !meta.segmentPaths.includes(segment)
      )
        fail("Unreviewed response cache segment");
      payload(file, "rsc", policy.routes.get(base), base);
      return true;
    }
  // Temporary atomic files and unknown kinds/routes stay blocked; root may retry
  // after Next finishes, never broaden the compiled worker namespace.
  fail("Unknown response cache payload path/extension");
}
