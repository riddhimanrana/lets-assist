import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const BRACES_EXCEPTION = Object.freeze({
  advisory: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  package: "braces",
  version: "3.0.3",
  expiresAt: "2026-10-21T00:00:00.000Z",
  owner: "repository owner",
  graphHashes: {
    ".": "622e0b536ac1e461bf1e9ec1c2762f68a11d5665031b325c5735fcb261f4101d",
    "packages/plugin-sdk":
      "34f55231c04ea7e1af41fccf7e25b1b46cd454b24cb14c63adc5e3dda944e99b",
    "lib/plugins/private/apps/csf":
      "9d796bd5ef82b74367dd6d76588d98a618b5c46ddc61eb8682e42109bc9ed82b",
  },
  affectedGraphs: [".", "lib/plugins/private/apps/csf"],
  sourceHashes: {
    "scripts/run-tests.mjs":
      "c018dbc55d966f8bf129f2320aa6e2fc0586e49831dda3cc3ec594eaa087cf0f",
    "scripts/generate-audit-surface-inventory.mjs":
      "83018c843b436145cb11e99ac6ab48de52547854505062da943e7be789b1d36a",
    "next-sitemap.config.js":
      "aeb6892c0a0fac0f98b751a8b4d61ba9f53fdc07eb14363463d37c63c31dc5cf",
    "next.config.ts":
      "4abbf269b00471f8a15ea650eccf7ffa5527ac33937fe46b9e157263151eaa65",
    "eslint.config.mjs":
      "4b7409a0fb5fe369cd5cf9505ee1b58f52dc95982daae84ced9c3b6940c8c706",
    "proxy.ts":
      "4c9e1ce0568f2d7b0300d16ab8955d774950f28edc1dea0133f7500fe3d42618",
    "lib/plugins/private/apps/csf/next.config.ts":
      "1af3e0eb885ae8b6894b1307c6d50dd6704d092c46e5c85bd963c5f7195df577",
    "lib/plugins/private/apps/csf/eslint.config.mjs":
      "6ad5808623254922856641f1fb00cf75c1d669f0275a245f2b1cadbeb1cf9aa8",
    "lib/plugins/private/apps/csf/app/layout.tsx":
      "5162abd3f60c3c39cd46bce283e9d80320099df0e18f55fd92fbcdd8844654a1",
  },
});

export function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function trackedSourceFiles(root) {
  return ["", "lib/plugins/private"]
    .flatMap((prefix) =>
      execFileSync("git", ["ls-files", "-z"], {
        cwd: join(root, prefix),
        encoding: "utf8",
      })
        .split("\0")
        .filter(Boolean)
        .map((file) => (prefix ? `${prefix}/${file}` : file)),
    )
    .filter(
      (file) =>
        /\.(?:[cm]?js|tsx?)$/u.test(file) && !/\.(?:test|spec)\./u.test(file),
    );
}

export function assertReviewedBracesInputs(
  root,
  environment,
  policy = BRACES_EXCEPTION,
  list = trackedSourceFiles,
) {
  if (Object.hasOwn(environment, "VC_MICROFRONTENDS_CONFIG_FILE_NAME")) {
    throw new Error(
      "Braces exception requires the custom microfrontends filename to be absent.",
    );
  }
  for (const [file, expected] of Object.entries(policy.sourceHashes)) {
    if (fileHash(join(root, file)) !== expected)
      throw new Error(`Braces input requires review: ${file}.`);
  }
  for (const file of list(root)) {
    if (
      Object.hasOwn(policy.sourceHashes, file) ||
      file.startsWith("scripts/security/")
    )
      continue;
    const source = readFileSync(join(root, file), "utf8");
    // Literal module names cover static imports, require, re-exports, and dynamic imports.
    if (
      /["'`](?:braces|micromatch|fast-glob|globby|glob|ts-morph|shadcn|next-sitemap|@vercel\/microfrontends)(?:\/[^"'`]*)?["'`]/u.test(
        source,
      )
    ) {
      throw new Error(`Unreviewed glob dependency import: ${file}.`);
    }
  }
}

export function acceptBracesFinding({
  finding,
  graph,
  graphs,
  root,
  environment = process.env,
  now = new Date(),
  policy = BRACES_EXCEPTION,
  checkInputs = assertReviewedBracesInputs,
}) {
  if (
    finding.package !== policy.package ||
    finding.url !== policy.advisory ||
    finding.severity !== "high"
  )
    return false;
  if (!Number.isFinite(now.getTime()) || now >= new Date(policy.expiresAt))
    throw new Error("Braces exception expired; remove or re-review it.");
  if (!policy.affectedGraphs.includes(graph.label))
    throw new Error("Braces appeared in an unreviewed package graph.");
  const expectedLabels = Object.keys(policy.graphHashes).sort();
  if (
    JSON.stringify(graphs.map(({ label }) => label).sort()) !==
    JSON.stringify(expectedLabels)
  )
    throw new Error(
      "Package graph inventory changed; review the braces exception.",
    );
  for (const candidate of graphs) {
    const lock = join(candidate.directory, "bun.lock");
    if (fileHash(lock) !== policy.graphHashes[candidate.label])
      throw new Error(
        `Lockfile changed; review the braces exception for ${candidate.label}.`,
      );
  }
  const lock = readFileSync(join(graph.directory, "bun.lock"), "utf8");
  const versions = [
    ...lock.matchAll(/"(?:[^"\n]*\/)?braces"\s*:\s*\[\s*"braces@([^"\n]+)"/gu),
  ].map((match) => match[1]);
  if (
    !versions.length ||
    versions.some((version) => version !== policy.version)
  )
    throw new Error("Braces resolved version changed; review the exception.");
  checkInputs(root, environment, policy);
  return true;
}
