"use strict";
// One reviewed Next16.4 embedded code asset. It is FROZEN, never mutable cache.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const SOURCE_RELATIVE =
  "node_modules/next/dist/compiled/@vercel/og/index.node.js";
const SOURCE_SHA256 =
  "ea30837b18ace5bdec33fe45fb90e238752f128f57364da08238980d43212ccb";
const BODY_SHA256 =
  "7ba9c9483c8c38a468e9aef4a95ed72fad8a43594be8e5123eb3bdb6479edf5b";
const URI_SHA256 =
  "2a3af1723c9ab5dd5a0bf6ac4440cee82a86d74bb1de1b5ed95c75ef7ce05f87";
const CACHE_KEY =
  "717edc4fb3be6fc4de1000790fb2eeae52e7fddc659ae6b7b977a5824bc36060";
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const refused = () => {
  throw Error("Pinned embedded WASM cache source drifted");
};
function immutableWasmDescriptor() {
  return {
    nextVersion: "16.4.0",
    sourceRelative: SOURCE_RELATIVE,
    sourceSha256: SOURCE_SHA256,
    bodySha256: BODY_SHA256,
    uriSha256: URI_SHA256,
    decodedBytes: 71736,
    cacheKey: CACHE_KEY,
    mutable: false,
  };
}
function readPinnedEmbeddedWasm(repo) {
  const nodeRoot = fs.realpathSync(path.join(repo, "node_modules")),
    target = path.join(repo, SOURCE_RELATIVE),
    real = fs.realpathSync(target),
    st = fs.lstatSync(real);
  if (
    !real.startsWith(nodeRoot + path.sep) ||
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid()
  )
    refused();
  const bytes = fs.readFileSync(real);
  if (hash(bytes) !== SOURCE_SHA256) refused();
  const uris =
    bytes
      .toString("utf8")
      .match(/data:application\/octet-stream;base64,[A-Za-z0-9+/=]+/gu) ?? [];
  if (uris.length !== 1 || hash(Buffer.from(uris[0])) !== URI_SHA256) refused();
  const uri = uris[0],
    body = uri.slice("data:application/octet-stream;base64,".length),
    decoded = Buffer.from(body, "base64");
  if (
    decoded.length !== 71736 ||
    decoded.toString("base64") !== body ||
    decoded.subarray(0, 8).toString("hex") !== "0061736d01000000" ||
    hash(decoded) !== BODY_SHA256
  )
    refused();
  // Bound Next v4 key tuple and OG's exact credentials:'same-origin' fetch.
  const key = hash(
    Buffer.from(
      JSON.stringify([
        "v4",
        "",
        uri,
        null,
        null,
        {},
        null,
        null,
        "same-origin",
        null,
        null,
        null,
        null,
        [],
      ]),
    ),
  );
  if (key !== CACHE_KEY) refused();
  return { uri, body, key };
}
const exactKeys = (o, keys) =>
  o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  Object.keys(o).sort().join(",") === [...keys].sort().join(",");
function frozenEmbeddedWasmFetch(record, key, repo) {
  if (
    typeof record?.data?.url !== "string" ||
    !record.data.url.startsWith("data:")
  )
    return false;
  const source = readPinnedEmbeddedWasm(repo);
  return (
    key === source.key &&
    /^[a-f0-9]{64}$/u.test(key) &&
    exactKeys(record, ["kind", "data", "revalidate", "tags"]) &&
    record.kind === "FETCH" &&
    exactKeys(record.data, ["headers", "body", "status", "url"]) &&
    exactKeys(record.data.headers, ["content-type"]) &&
    record.data.headers["content-type"] === "application/octet-stream" &&
    record.data.status === 200 &&
    record.revalidate === 31536000 &&
    Array.isArray(record.tags) &&
    record.tags.length === 0 &&
    record.data.url === source.uri &&
    record.data.body === source.body
  );
}
module.exports = {
  SOURCE_RELATIVE,
  SOURCE_SHA256,
  immutableWasmDescriptor,
  readPinnedEmbeddedWasm,
  frozenEmbeddedWasmFetch,
};
