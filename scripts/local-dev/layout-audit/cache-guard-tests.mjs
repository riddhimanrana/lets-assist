// Offline data-cache controls only; no real cache or runtime is touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BUILD_ARTIFACTS, digest } from "./capture-contract.mjs";
import {
  freezeCompiledFiles,
  exactCompiledFiles,
} from "./capture-runtime-contract.mjs";
import {
  cachePolicyFromCompiled,
  exactRuntimeCacheSources,
} from "./capture-cache-contract.mjs";
export function runCacheGuards() {
  let checks = 0;
  const allow = (fn) => {
      fn();
      checks++;
    },
    deny = (fn) => {
      assert.throws(fn);
      checks++;
    };
  const tmp = fs.realpathSync(
    fs.mkdtempSync(new URL("./.offline-cache-", import.meta.url).pathname),
  );
  try {
    const dir = path.join(tmp, "build");
    fs.mkdirSync(path.join(dir, "server/app/faq"), { recursive: true });
    fs.mkdirSync(path.join(dir, "static/chunks"), { recursive: true });
    const appPaths = {
      "/page": "app/page.js",
      "/faq/page": "app/faq/page.js",
      "/projects/[id]/page": "app/projects/[id]/page.js",
      "/organization/[id]/plugins/[pluginKey]/[[...slug]]/page":
        "app/organization/[id]/plugins/[pluginKey]/[[...slug]]/page.js",
    };
    for (const f of BUILD_ARTIFACTS)
      fs.writeFileSync(
        path.join(dir, f),
        f === "server/app-paths-manifest.json"
          ? JSON.stringify(appPaths)
          : "OFFLINE COMPILED",
      );
    fs.writeFileSync(path.join(dir, "server/app/page.js"), "FROZEN WORKER");
    fs.writeFileSync(
      path.join(dir, "server/app/faq/page.js"),
      "FROZEN FAQ WORKER",
    );
    fs.writeFileSync(path.join(dir, "static/chunks/app.js"), "FROZEN STATIC");
    const proof = exactRuntimeCacheSources(),
      manifest = digest(
        fs.readFileSync(path.join(dir, "server/app-paths-manifest.json")),
      ),
      paths = [
        "/",
        "/faq",
        "/projects/10000000-0000-4000-8000-000000000020",
        "/organization/dvhs-csf/plugins/dvhs-csf/home",
      ];
    const policy = cachePolicyFromCompiled(appPaths, paths, manifest, proof);
    policy.loopbackOrigins = [
      "http://127.0.0.1:3057",
      "http://127.0.0.1:55081",
    ];
    const frozen = freezeCompiledFiles(dir, policy);
    allow(() => assert.equal(policy.routes.size, 4));
    for (const selected of ["/unknown", "/faq?query=x", "/logout", "/faq#hash"])
      deny(() =>
        cachePolicyFromCompiled(appPaths, [selected], manifest, proof),
      );
    deny(() =>
      cachePolicyFromCompiled(
        { ...appPaths, "/(other)/faq/page": "app/other/faq/page.js" },
        ["/faq"],
        manifest,
        proof,
      ),
    );
    deny(() =>
      cachePolicyFromCompiled(
        { "/page": "app/../worker.js" },
        ["/"],
        manifest,
        proof,
      ),
    );
    const imageDir = path.join(dir, "cache/images", "A".repeat(43));
    fs.mkdirSync(imageDir, { recursive: true });
    const image = path.join(imageDir, "30.1791720000000.etag.upstream.png");
    fs.writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
    allow(() => exactCompiledFiles(dir, frozen, policy));
    fs.writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]));
    allow(() => exactCompiledFiles(dir, frozen, policy));
    const fetchDir = path.join(dir, "cache/fetch-cache");
    fs.mkdirSync(fetchDir, { recursive: true });
    const fetch = path.join(fetchDir, "a".repeat(64));
    const record = {
      kind: "FETCH",
      data: { headers: {}, body: '{"enabled":false}', status: 200, url: "" },
      revalidate: 30,
      tags: ["landing-demo-mode"],
    };
    fs.writeFileSync(fetch, JSON.stringify(record));
    allow(() => exactCompiledFiles(dir, frozen, policy));
    fs.writeFileSync(
      fetch,
      JSON.stringify({
        ...record,
        data: { ...record.data, body: '{"enabled":true}' },
      }),
    );
    allow(() => exactCompiledFiles(dir, frozen, policy));
    const base = [...policy.routes.keys()].find((p) => p.endsWith("/$/index"));
    fs.mkdirSync(path.dirname(path.join(dir, base)), { recursive: true });
    const html = path.join(dir, base + ".html"),
      meta = path.join(dir, base + ".meta"),
      rsc = path.join(dir, base + ".rsc");
    fs.writeFileSync(html, "<!doctype html><html>OFFLINE CACHE DATA</html>");
    fs.writeFileSync(
      meta,
      JSON.stringify({
        headers: {},
        status: 200,
        routeCache: { owner: { kind: "APP_PAGE", sourceRoute: "/page" } },
      }),
    );
    fs.writeFileSync(rsc, '0:["OFFLINE DATA"]\n');
    allow(() => exactCompiledFiles(dir, frozen, policy));
    fs.writeFileSync(html, "<!doctype html><html>CHANGED CACHE DATA</html>");
    allow(() => exactCompiledFiles(dir, frozen, policy));
    for (const file of [
      "server/app/page.js",
      "server/app/faq/page.js",
      "static/chunks/app.js",
      "server/app-paths-manifest.json",
    ]) {
      const original = fs.readFileSync(path.join(dir, file));
      fs.writeFileSync(path.join(dir, file), "WORKER/STATIC/MANIFEST TAMPER");
      deny(() => exactCompiledFiles(dir, frozen, policy));
      fs.writeFileSync(path.join(dir, file), original);
    }
    for (const file of [
      path.join(imageDir, "worker.js"),
      path.join(imageDir, "30.1791720000000.etag.upstream.js"),
      path.join(fetchDir, "worker.js"),
      path.join(dir, base + ".js"),
      path.join(dir, base + ".html.fake.tmp"),
    ]) {
      fs.writeFileSync(file, 'module.exports = "NOT DATA"');
      deny(() => exactCompiledFiles(dir, frozen, policy));
      fs.unlinkSync(file);
    }
    const raster = fs.readFileSync(image);
    fs.writeFileSync(image, 'module.exports = "NOT RASTER"');
    deny(() => exactCompiledFiles(dir, frozen, policy));
    fs.writeFileSync(image, raster);
    for (const file of [image, fetch, html]) {
      fs.chmodSync(file, 0o755);
      deny(() => exactCompiledFiles(dir, frozen, policy));
      fs.chmodSync(file, 0o600);
    }
    for (const change of [
      { kind: "APP_PAGE" },
      { extra: "worker" },
      { data: { ...record.data, url: "https://lets-assist.com/private" } },
      { data: { ...record.data, url: "http://127.0.0.1:3058/private" } },
      { data: { ...record.data, body: 42 } },
      { tags: [42] },
    ]) {
      fs.writeFileSync(fetch, JSON.stringify({ ...record, ...change }));
      deny(() => exactCompiledFiles(dir, frozen, policy));
    }
    fs.writeFileSync(fetch, JSON.stringify(record));
    for (const [file, value] of [
      [html, 'module.exports = "NOT HTML"'],
      [rsc, 'module.exports = "NOT RSC"'],
      [meta, '{"worker":"code"}'],
      [
        meta,
        JSON.stringify({
          headers: {},
          routeCache: {
            owner: { kind: "APP_PAGE", sourceRoute: "/other/page" },
          },
        }),
      ],
    ]) {
      const original = fs.readFileSync(file);
      fs.writeFileSync(file, value);
      deny(() => exactCompiledFiles(dir, frozen, policy));
      fs.writeFileSync(file, original);
    }
    for (const rel of [
      "server/route-cache/APP_ROUTE",
      "server/route-cache/PAGES",
      "server/route-cache/APP_PAGE/" + "0".repeat(64),
      "server/route-cache/APP_PAGE/" +
        digest(Buffer.from("/page")) +
        "/$/unknown",
    ]) {
      const extra = path.join(dir, rel);
      fs.mkdirSync(extra, { recursive: true });
      deny(() => exactCompiledFiles(dir, frozen, policy));
      fs.rmSync(extra, { recursive: true });
    }
    const adjacent = path.join(dir, "cache/image-cache");
    fs.mkdirSync(adjacent);
    fs.writeFileSync(path.join(adjacent, "extra.png"), "ADJACENT");
    deny(() => exactCompiledFiles(dir, frozen, policy));
    fs.rmSync(adjacent, { recursive: true });
    const outside = path.join(tmp, "outside.png");
    fs.writeFileSync(outside, raster);
    fs.unlinkSync(image);
    fs.symlinkSync(outside, image);
    deny(() => exactCompiledFiles(dir, frozen, policy));
    fs.unlinkSync(image);
    fs.writeFileSync(image, raster);
    fs.mkdirSync(path.join(dir, base + ".segments"));
    fs.writeFileSync(
      path.join(dir, base + ".segments/_tree.segment.rsc"),
      '0:["OFFLINE SEGMENT"]\n',
    );
    deny(() => exactCompiledFiles(dir, frozen, policy));
    fs.writeFileSync(
      meta,
      JSON.stringify({ headers: {}, segmentPaths: ["/_tree"] }),
    );
    allow(() => exactCompiledFiles(dir, frozen, policy));
    fs.writeFileSync(
      path.join(dir, base + ".segments/worker.js"),
      "EXECUTABLE",
    );
    deny(() => exactCompiledFiles(dir, frozen, policy));
    fs.unlinkSync(path.join(dir, base + ".segments/worker.js"));
    allow(() => exactCompiledFiles(dir, frozen, policy));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return {
    checks,
    realCachesTouched: false,
    compiledCodeDriftRefused: true,
    networkStarted: false,
  };
}
