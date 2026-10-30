#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptBracesFinding, BRACES_EXCEPTION } from "./braces-exception.mjs";

// The reviewed local repair of deepmerge 4.3.1 (GHSA-gcqx-w48m-w2h4). Bun does
// not audit `file:` packages, so this binds the exact override, manifest,
// executable sources and every root lock resolution instead.
export const DEEPMERGE_COMPAT = Object.freeze({
  directory: "vendor/deepmerge-compat",
  override: "file:./vendor/deepmerge-compat",
  hoisted:
    '"deepmerge": ["@lets-assist/deepmerge-compat@file:vendor/deepmerge-compat", {}]',
  files: Object.freeze({
    "package.json":
      "0ae8dda84b8f2b89b38de085f5b1b86dc70f94d00640583105d847969de6b58f",
    "index.cjs":
      "f17f18c2d9584465de99958287d2410c71a04db5575d790059602dd9fbf6a87f",
    "index.d.ts":
      "054966c8bd235dab582b7e0ab63c8cdd7576526bd003d1b84e99fad1f37fa1c2",
  }),
  documents: Object.freeze([
    "README.md",
    "ghsa-gcqx-w48m-w2h4.patch",
    "license.txt",
  ]),
});

function assertDeepmergeCompat(repository, tracked, manifest, lockfiles) {
  const { directory, override, hoisted, files, documents } = DEEPMERGE_COMPAT;
  const refusal =
    "The vendored deepmerge repair must remain the exact reviewed package bound to the root lockfile.";
  if (!tracked.has("package.json") || !tracked.has("bun.lock"))
    throw new Error(refusal);
  const owner = JSON.parse(
    readFileSync(join(repository, "package.json"), "utf8"),
  );
  const lock = readFileSync(join(repository, "bun.lock"), "utf8");
  const resolutions = [...lock.matchAll(/\["deepmerge@([^"]*)"/gu)].map(
    (match) => match[1],
  );
  const local = [...tracked]
    .filter((file) => file.startsWith(`${directory}/`))
    .map((file) => file.slice(directory.length + 1))
    .sort();
  if (
    owner.overrides?.deepmerge !== override ||
    owner.dependencies?.deepmerge !== "^4.3.1" ||
    manifest.name !== "@lets-assist/deepmerge-compat" ||
    manifest.version !== "0.0.0" ||
    manifest.dependencies !== undefined ||
    manifest.scripts !== undefined ||
    lockfiles.length !== 0 ||
    lock.split(hoisted).length !== 2 ||
    !resolutions.length ||
    resolutions.some((resolution) => resolution !== override) ||
    JSON.stringify(local) !==
      JSON.stringify([...Object.keys(files), ...documents].sort())
  )
    throw new Error(refusal);
  for (const [file, expected] of Object.entries(files)) {
    const path = join(repository, directory, file);
    if (
      !lstatSync(path).isFile() ||
      createHash("sha256").update(readFileSync(path)).digest("hex") !== expected
    )
      throw new Error(refusal);
  }
}

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

export function assertExactPrivateGitlink(root, exec = execFileSync) {
  const expected = exec("git", ["rev-parse", ":lib/plugins/private"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const actual = exec("git", ["rev-parse", "HEAD"], {
    cwd: join(root, "lib/plugins/private"),
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/u.test(expected) || expected !== actual) {
    throw new Error(
      "The private checkout must match the root index gitlink before auditing.",
    );
  }
}

export function discoverPackageGraphs(root, listFiles = trackedFiles) {
  const privateRoot = join(root, "lib/plugins/private");
  if (!existsSync(join(privateRoot, ".git"))) {
    throw new Error(
      "Initialize the exact private submodule before auditing dependencies.",
    );
  }
  if (!lstatSync(join(root, "package.json")).isFile()) {
    throw new Error("Root package metadata must be a regular file.");
  }
  const rootManifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const expectedManager = rootManifest.packageManager;
  const graphs = [];
  for (const repository of [root, privateRoot]) {
    const tracked = new Set(listFiles(repository));
    // An override without the tracked reviewed package would install
    // unreviewed or missing local source that the audit cannot see.
    if (
      repository === root &&
      rootManifest.overrides?.deepmerge !== undefined &&
      !tracked.has(`${DEEPMERGE_COMPAT.directory}/package.json`)
    )
      throw new Error(
        "The deepmerge override requires the tracked reviewed vendor package.",
      );
    const manifests = [...tracked]
      .filter((file) => /(?:^|\/)package\.json$/u.test(file))
      .sort();
    for (const manifestPath of manifests) {
      const directory = dirname(manifestPath);
      const manifestFile = join(repository, manifestPath);
      if (!lstatSync(manifestFile).isFile()) {
        throw new Error("Package metadata must be regular files.");
      }
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
      const lockfiles = ["bun.lock", "bun.lockb"]
        .map((name) => (directory === "." ? name : `${directory}/${name}`))
        .filter((file) => tracked.has(file));
      const label = relative(root, join(repository, directory)) || ".";
      if (repository === root && directory === DEEPMERGE_COMPAT.directory) {
        assertDeepmergeCompat(repository, tracked, manifest, lockfiles);
        continue;
      }
      // Each exact local compatibility package belongs to its application's
      // audited lockfile. Other vendor packages remain independent graphs.
      const compatibilityOwner =
        repository === root && directory === "vendor/fast-glob-compat"
          ? ""
          : repository === privateRoot &&
              directory === "apps/csf/vendor/fast-glob-compat"
            ? "apps/csf"
            : null;
      if (compatibilityOwner !== null) {
        const ownerPrefix = compatibilityOwner ? `${compatibilityOwner}/` : "";
        const refusal =
          "The vendored fast-glob dependency must remain covered by the " +
          (compatibilityOwner ? "CSF application" : "root") +
          " lockfile.";
        if (
          !tracked.has(`${ownerPrefix}package.json`) ||
          !tracked.has(`${ownerPrefix}bun.lock`)
        )
          throw new Error(refusal);
        const ownerManifest = JSON.parse(
          readFileSync(join(repository, ownerPrefix, "package.json"), "utf8"),
        );
        const ownerLock = readFileSync(
          join(repository, ownerPrefix, "bun.lock"),
          "utf8",
        );
        if (
          ownerManifest.overrides?.["fast-glob"] !==
            "file:./vendor/fast-glob-compat" ||
          manifest.name !== "fast-glob" ||
          manifest.version !== "3.3.3-lets-assist.1" ||
          JSON.stringify(manifest.dependencies) !==
            JSON.stringify({ tinyglobby: "0.2.17" }) ||
          lockfiles.length !== 0 ||
          !/"fast-glob@file:(?:\.\/)?vendor\/fast-glob-compat"/u.test(
            ownerLock,
          ) ||
          !ownerLock.includes('"tinyglobby@0.2.17"')
        )
          throw new Error(refusal);
        continue;
      }
      if (
        manifest.packageManager !== expectedManager ||
        !/^bun@\d+\.\d+\.\d+$/u.test(expectedManager)
      ) {
        throw new Error(
          `${label}: packageManager must match the exact root Bun pin.`,
        );
      }
      if (lockfiles.length !== 1) {
        throw new Error(`${label}: expected exactly one tracked Bun lockfile.`);
      }
      for (const file of [manifestPath, lockfiles[0]]) {
        if (!lstatSync(join(repository, file)).isFile()) {
          throw new Error(`${label}: package metadata must be regular files.`);
        }
      }
      graphs.push({ label, directory: join(repository, directory) });
    }
  }
  if (!graphs.some((graph) => graph.label === ".")) {
    throw new Error("The root package graph is missing.");
  }
  return graphs;
}

export function parseAuditReport(output) {
  const report = JSON.parse(output);
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw new Error("Invalid audit JSON.");
  return Object.entries(report).flatMap(([name, advisories]) => {
    if (
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(name) ||
      !Array.isArray(advisories) ||
      !advisories.length
    )
      throw new Error("Invalid advisory collection.");
    return advisories.map((advisory) => {
      if (
        !advisory ||
        typeof advisory !== "object" ||
        Array.isArray(advisory) ||
        !Number.isSafeInteger(advisory.id) ||
        typeof advisory.title !== "string" ||
        !/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9-]+$/u.test(
          advisory.url,
        ) ||
        !["low", "moderate", "high", "critical"].includes(advisory.severity) ||
        typeof advisory.vulnerable_versions !== "string"
      )
        throw new Error("Invalid advisory JSON.");
      return { ...advisory, package: name };
    });
  });
}

export function auditPackageGraphs(
  graphs,
  {
    productionOnly = false,
    environment = process.env,
    spawn = spawnSync,
    log = console.log,
    acceptFinding = acceptBracesFinding,
  } = {},
) {
  const temporaryHome = mkdtempSync(
    join(tmpdir(), "lets-assist-dependency-audit-"),
  );
  const allowed = new Set([
    "PATH",
    "CI",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SYSTEMROOT",
  ]);
  const env = {
    ...Object.fromEntries(
      Object.entries(environment).filter(([key]) => allowed.has(key)),
    ),
    HOME: temporaryHome,
    XDG_CONFIG_HOME: temporaryHome,
    BUN_INSTALL_CACHE_DIR: join(temporaryHome, "bun-cache"),
  };
  const failed = [];
  let accepted = 0;
  const root = graphs.find((graph) => graph.label === ".")?.directory;
  try {
    for (const graph of graphs) {
      log(
        `[dependency-audit] ${graph.label}: ${productionOnly ? "production" : "all"} dependencies`,
      );
      const result = spawn(
        "bun",
        [
          "--no-env-file",
          "audit",
          "--json",
          ...(productionOnly ? ["--prod"] : []),
        ],
        {
          cwd: graph.directory,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      try {
        if (result.error || ![0, 1].includes(result.status))
          throw new Error("Audit process or registry failed.");
        const findings = parseAuditReport(result.stdout);
        if (!findings.length && result.status !== 0)
          throw new Error("Audit failed without a valid advisory report.");
        let unresolved = false;
        for (const finding of findings) {
          log(
            `[dependency-audit] ${graph.label}: ${finding.severity} ${finding.package} ${finding.url}`,
          );
          if (acceptFinding({ finding, graph, graphs, root, environment })) {
            accepted += 1;
            log(
              `[dependency-audit] ACCEPTED RISK until ${BRACES_EXCEPTION.expiresAt}: braces 3.0.3 remains vulnerable.`,
            );
          } else unresolved = true;
        }
        if (unresolved) failed.push(graph.label);
      } catch (error) {
        log(
          `[dependency-audit] ${graph.label}: ${error instanceof Error ? error.message : "audit validation failed"}`,
        );
        failed.push(graph.label);
      }
    }
  } finally {
    rmSync(temporaryHome, { recursive: true, force: true });
  }
  if (failed.length)
    throw new Error(`Dependency audit failed: ${failed.join(", ")}.`);
  log(
    accepted
      ? `[dependency-audit] Allowed with ${accepted} accepted risk findings until ${BRACES_EXCEPTION.expiresAt}; ${graphs.length} graphs checked.`
      : `[dependency-audit] PASS: ${graphs.length} independent package graphs; no advisories.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== "--prod")) {
    throw new Error("Only --prod is supported.");
  }
  assertExactPrivateGitlink(process.cwd());
  auditPackageGraphs(discoverPackageGraphs(process.cwd()), {
    productionOnly: arguments_.includes("--prod"),
  });
}
