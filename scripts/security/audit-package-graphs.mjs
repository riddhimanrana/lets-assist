#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
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
  const expectedManager = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).packageManager;
  const graphs = [];
  for (const repository of [root, privateRoot]) {
    const tracked = new Set(listFiles(repository));
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
