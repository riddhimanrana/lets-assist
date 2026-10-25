#!/usr/bin/env node
// One command for every hand-maintained pin the gate compares against.
//
//   bun run ci:pins            report everything that is out of date
//   bun run ci:pins --write    also regenerate the pins that are purely derived
//
// Two kinds of pin exist and they are treated differently.
//
// Derived pins are a function of the tree and nothing else: the host build
// surface and the migration digest list. --write regenerates the first and
// appends to the second. The digest list is append-only, so an existing entry
// is never rewritten, moved, or removed; a migration whose bytes no longer
// match its entry is reported as an error instead.
//
// Review pins record that a person looked at something: the advisory exception
// hashes, the accepted release catalog, and the maintainability baseline. This
// command never writes them. It reports the file, the value recorded now
// ("current"), the value the tree calls for ("expected"), and the document that
// says what the review must cover.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DIGESTS_PATH = "scripts/production/migration-digests.mjs";
const MIGRATION_NAME = /^\d{14}_.+\.sql$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Migration digests (derived, append-only)
// ---------------------------------------------------------------------------

export function compareMigrationDigests(recorded, actual) {
  const missing = [];
  const drifted = [];
  for (const [name, digest] of Object.entries(actual)) {
    if (!Object.hasOwn(recorded, name)) missing.push({ name, digest });
    else if (recorded[name] !== digest)
      drifted.push({ name, recorded: recorded[name], actual: digest });
  }
  const orphaned = Object.keys(recorded).filter(
    (name) => !Object.hasOwn(actual, name),
  );
  const byName = (left, right) => (left.name < right.name ? -1 : 1);
  return {
    missing: missing.sort(byName),
    drifted: drifted.sort(byName),
    orphaned: orphaned.sort(),
  };
}

function digestEntry({ name, digest }) {
  if (!MIGRATION_NAME.test(name) || !/^[0-9a-f]{64}$/u.test(digest))
    throw new Error(`Refusing to record an invalid digest entry: ${name}`);
  const oneLine = `  "${name}": "${digest}",`;
  // The repository formatter breaks after the key once the line passes 80.
  return oneLine.length <= 80 ? oneLine : `  "${name}":\n    "${digest}",`;
}

// Appends entries before the closing brace. Everything already in the file is
// kept byte for byte, in place.
export function appendMigrationDigests(source, entries) {
  if (entries.length === 0) return source;
  const closing = "\n};\n";
  if (!source.endsWith(closing) || source.split(closing).length !== 2)
    throw new Error(
      `${DIGESTS_PATH} no longer ends with its one object literal; append by hand.`,
    );
  for (const { name } of entries) {
    if (source.includes(`"${name}"`))
      throw new Error(`${DIGESTS_PATH} already names ${name}.`);
  }
  const body = source.slice(0, -closing.length);
  if (!body.endsWith(","))
    throw new Error(
      `${DIGESTS_PATH} has an unexpected last entry; append by hand.`,
    );
  return `${body}\n${entries.map(digestEntry).join("\n")}${closing}`;
}

function actualMigrationDigests(root) {
  const directory = join(root, "supabase/migrations");
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => MIGRATION_NAME.test(name))
      .sort()
      // Read as text, exactly as the release tests that compare these values.
      .map((name) => [
        name,
        sha256(readFileSync(join(directory, name), "utf8")),
      ]),
  );
}

async function migrationDigestReport(root, write) {
  const { migrationDigests } = await import(
    `${join(root, DIGESTS_PATH)}?read=${Date.now()}`
  );
  const comparison = compareMigrationDigests(
    migrationDigests,
    actualMigrationDigests(root),
  );
  const lines = [];
  let stale = false;
  let reviewRequired = false;

  if (comparison.missing.length > 0) {
    if (write) {
      const path = join(root, DIGESTS_PATH);
      writeFileSync(
        path,
        appendMigrationDigests(readFileSync(path, "utf8"), comparison.missing),
      );
      lines.push(
        `[pins] migration digests: appended ${comparison.missing.length} to ${DIGESTS_PATH}`,
      );
    } else {
      stale = true;
      lines.push(
        `[pins] STALE migration digests: ${comparison.missing.length} missing from ${DIGESTS_PATH}`,
      );
    }
    for (const { name, digest } of comparison.missing)
      lines.push(`  ${name}\n    needs ${digest}`);
    if (!write)
      lines.push(
        "  fix: bun run ci:pins --write (appends; existing entries are never changed)",
      );
  }
  if (comparison.drifted.length > 0) {
    reviewRequired = true;
    lines.push(
      `[pins] REVIEW REQUIRED migration digests: ${comparison.drifted.length} applied migrations no longer match their recorded bytes`,
      `  file: ${DIGESTS_PATH}`,
    );
    for (const { name, recorded, actual } of comparison.drifted)
      lines.push(`  ${name}\n    current  ${recorded}\n    expected ${actual}`);
    lines.push(
      "  This command never rewrites a recorded digest. A migration is an append-only ledger entry:",
      "  restore the file byte for byte and make the change in a new migration.",
      "  review: AGENTS.md (Non-negotiable boundaries), docs/development/supabase-deployment.md",
    );
  }
  if (comparison.orphaned.length > 0) {
    reviewRequired = true;
    lines.push(
      `[pins] REVIEW REQUIRED migration digests: ${comparison.orphaned.length} recorded migrations are missing from supabase/migrations`,
      `  file: ${DIGESTS_PATH}`,
      ...comparison.orphaned.map((name) => `  ${name}`),
      "  Entries are never removed here. Restore the migration file.",
    );
  }
  if (lines.length === 0)
    lines.push(
      `[pins] current: migration digests (${Object.keys(migrationDigests).length} entries)`,
    );
  return { lines, stale, reviewRequired };
}

// ---------------------------------------------------------------------------
// Host build surface (derived)
// ---------------------------------------------------------------------------

function hostBuildSurfaceReport(root, write) {
  const script = "scripts/plugins/collect-host-build-surface.mjs";
  const run = (args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
    });
  const check = run(["--check"]);
  if (check.status === 0)
    return {
      lines: ["[pins] current: host build surface"],
      stale: false,
      reviewRequired: false,
    };
  const detail = `${check.stdout}${check.stderr}`
    .trim()
    .split("\n")
    .map((line) => `  ${line}`);
  if (!write)
    return {
      lines: [
        "[pins] STALE host build surface: lib/plugins/host-build-surface.generated.json",
        ...detail,
        "  fix: bun run ci:pins --write (or bun run plugin:surface:generate)",
      ],
      stale: true,
      reviewRequired: false,
    };
  const generated = run([]);
  if (generated.status !== 0)
    throw new Error(
      `Host build surface generation failed:\n${generated.stdout}${generated.stderr}`,
    );
  return {
    lines: [
      "[pins] host build surface: regenerated lib/plugins/host-build-surface.generated.json",
      ...detail,
    ],
    stale: false,
    reviewRequired: false,
  };
}

// ---------------------------------------------------------------------------
// Review pins (reported, never written)
// ---------------------------------------------------------------------------

export function advisoryExceptionFindings(policy, hashOf, now = new Date()) {
  const findings = [];
  const compare = (kind, entries, pathOf) => {
    for (const [key, pinned] of Object.entries(entries)) {
      let current;
      try {
        current = hashOf(pathOf(key));
      } catch {
        current = "(file is missing)";
      }
      if (current !== pinned)
        findings.push({
          entry: `${kind}[${JSON.stringify(key)}]`,
          pinned,
          current,
        });
    }
  };
  compare("sourceHashes", policy.sourceHashes, (file) => file);
  compare("graphHashes", policy.graphHashes, (graph) =>
    join(graph, "bun.lock"),
  );
  const expires = new Date(policy.expiresAt);
  const daysLeft = Math.floor((expires - now) / 86_400_000);
  return { findings, expired: !(now < expires), daysLeft };
}

async function advisoryExceptionReport(root) {
  const file = "scripts/security/braces-exception.mjs";
  const { BRACES_EXCEPTION, fileHash, assertReviewedBracesInputs } =
    await import(join(root, file));
  const { findings, expired, daysLeft } = advisoryExceptionFindings(
    BRACES_EXCEPTION,
    (path) => fileHash(join(root, path)),
  );
  const lines = [];
  for (const { entry, pinned, current } of findings)
    lines.push(`  ${entry}\n    current  ${pinned}\n    expected ${current}`);
  if (expired)
    lines.push(
      `  expiresAt\n    current  ${BRACES_EXCEPTION.expiresAt}\n    expected expired; the exception must be removed or accepted again`,
    );
  // The policy's own check also refuses new literal imports of the affected
  // packages. Report that failure too when the hashes above did not explain it.
  if (findings.length === 0) {
    try {
      assertReviewedBracesInputs(root, {});
    } catch (error) {
      lines.push(`  ${error.message}`);
    }
  }
  if (lines.length === 0)
    return {
      lines: [
        `[pins] current: advisory exception hashes (acceptance expires in ${daysLeft} days, ${BRACES_EXCEPTION.expiresAt})`,
      ],
      stale: false,
      reviewRequired: false,
    };
  return {
    lines: [
      "[pins] REVIEW REQUIRED advisory exception hashes",
      `  file: ${file}`,
      ...lines,
      "  This command does not write these. Each hash records that a person read the file's glob inputs.",
      "  Read the diff, confirm no pattern can come from a request, an environment variable, or a user,",
      "  then update the hash by hand and add a dated note of what was reviewed.",
      "  review: docs/development/dependency-security.md",
    ],
    stale: false,
    reviewRequired: true,
  };
}

async function releaseCatalogReport(root) {
  const file = "scripts/production/app-release-catalog.mjs";
  const { acceptedCatalogQuery } = await import(join(root, file));
  const { expectedVersions } = await import(
    join(root, "scripts/production/app-release-checks.mjs")
  );
  const { ledgerDigest } = await import(
    join(root, "scripts/production/final-schema-manifest.mjs")
  );
  const versions = expectedVersions(root);
  const current = ledgerDigest(versions);
  try {
    acceptedCatalogQuery(
      readFileSync(
        join(root, "scripts/production/verify-csf-target-schema.sql"),
        "utf8",
      ),
      versions,
    );
  } catch (error) {
    return {
      lines: [
        "[pins] REVIEW REQUIRED release catalog acceptance",
        `  file: ${file}`,
        `  current  no accepted catalog for this ledger (${error.message})`,
        `  expected an accepted catalog for ${versions.length} migrations, newest ${versions.at(-1)}, ledger digest ${current}`,
        "  This command does not write it. An accepted catalog comes from an owned isolated replay of the",
        "  whole ledger, with its database tests green and every changed object explained by a migration.",
        "  review: scripts/production/final-schema-manifest.md, docs/development/supabase-deployment.md",
      ],
      stale: false,
      reviewRequired: true,
    };
  }
  return {
    lines: [
      `[pins] current: release catalog acceptance (${versions.length} migrations, ledger ${current.slice(0, 12)})`,
    ],
    stale: false,
    reviewRequired: false,
  };
}

function lineCount(contents) {
  return contents === ""
    ? 0
    : contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0);
}

async function maintainabilityBaselineReport(root) {
  const file = "scripts/source-maintainability-baseline.json";
  const {
    findMaintainabilityIssues,
    getTrackedFiles,
    maintainabilityRepositoryName,
  } = await import(join(root, "scripts/check-source-organization.mjs"));
  const baseline = JSON.parse(readFileSync(join(root, file), "utf8"));
  const lines = [];
  for (const directory of [root, join(root, "lib/plugins/private")]) {
    if (!existsSync(directory)) continue;
    const tracked = getTrackedFiles(directory);
    const repository = maintainabilityRepositoryName(tracked);
    const prefix = directory === root ? "" : "lib/plugins/private/";
    const sizes = new Map(
      tracked
        .filter((name) => /\.(?:[cm]?js|jsx|tsx?)$/iu.test(name))
        .map((name) => [
          name,
          lineCount(readFileSync(join(directory, name), "utf8")),
        ]),
    );
    const issues = findMaintainabilityIssues(
      [...sizes].map(([name, count]) => ({ file: name, lines: count })),
      repository,
    );
    for (const issue of issues) {
      const reviewed = baseline.repositories?.[repository]?.[issue.file];
      lines.push(
        `  ${prefix}${issue.file}\n    current  ${reviewed === undefined ? "no baseline entry (new files get no allowance)" : `${reviewed} lines`}\n    expected ${sizes.get(issue.file)} lines (${issue.message})`,
      );
    }
  }
  if (lines.length === 0)
    return {
      lines: [
        `[pins] current: source maintainability baseline (reviewed ${baseline.reviewedAt})`,
      ],
      stale: false,
      reviewRequired: false,
    };
  return {
    lines: [
      "[pins] REVIEW REQUIRED source maintainability baseline",
      `  file: ${file}`,
      ...lines,
      "  This command does not write it. The baseline is a ratchet for old debt, not a budget:",
      "  split the module below its limit instead of raising the recorded size.",
      "  review: docs/development/source-maintenance.md",
    ],
    stale: false,
    reviewRequired: true,
  };
}

export function pinArguments(args) {
  const unknown = args.filter(
    (argument) => argument !== "--check" && argument !== "--write",
  );
  if (
    unknown.length > 0 ||
    (args.includes("--check") && args.includes("--write"))
  )
    throw new Error("Usage: bun run ci:pins [--check | --write]");
  return { write: args.includes("--write") };
}

async function main() {
  const { write } = pinArguments(process.argv.slice(2));
  const reports = [
    hostBuildSurfaceReport(repositoryRoot, write),
    await migrationDigestReport(repositoryRoot, write),
    await advisoryExceptionReport(repositoryRoot),
    await releaseCatalogReport(repositoryRoot),
    await maintainabilityBaselineReport(repositoryRoot),
  ];
  for (const report of reports) console.log(report.lines.join("\n"));
  const stale = reports.filter((report) => report.stale).length;
  const review = reports.filter((report) => report.reviewRequired).length;
  if (stale === 0 && review === 0) {
    console.log("[pins] Everything is current.");
    return 0;
  }
  console.log(
    `[pins] ${stale} derived ${stale === 1 ? "pin is" : "pins are"} stale${stale > 0 ? " (bun run ci:pins --write)" : ""}; ${review} review ${review === 1 ? "pin needs" : "pins need"} a person.`,
  );
  return 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`[pins] ${error.message}`);
    process.exit(1);
  }
}
