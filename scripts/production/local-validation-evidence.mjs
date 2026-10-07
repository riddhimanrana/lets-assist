import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const localValidationChecks = [
  "lint",
  "typecheck",
  "unit",
  "build",
  "database",
  "browser",
];
const sha = /^[a-f0-9]{40}$/u;
const digest = /^[a-f0-9]{64}$/u;
const dayMs = 24 * 60 * 60 * 1000;
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function keys(value, expected) {
  requireValue(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === [...expected].sort().join(),
    "Evidence has unknown or missing fields.",
  );
}
function timestamp(value) {
  requireValue(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
      Number.isFinite(Date.parse(value)),
    "Evidence timestamp is invalid.",
  );
  return Date.parse(value);
}

export function verifyLocalValidationEvidence(
  receipt,
  expected,
  { now = Date.now(), readReport } = {},
) {
  keys(receipt, [
    "schemaVersion",
    "kind",
    "releaseSha",
    "acceptedSha",
    "gitTree",
    "privateGitlink",
    "actor",
    "issuedAt",
    "expiresAt",
    "changeRecord",
    "checks",
  ]);
  requireValue(
    receipt.schemaVersion === 1 && receipt.kind === "operator-local-validation",
    "Evidence kind is unsupported.",
  );
  for (const field of [
    "releaseSha",
    "acceptedSha",
    "gitTree",
    "privateGitlink",
  ])
    requireValue(
      sha.test(receipt[field] ?? "") && receipt[field] === expected[field],
      "Evidence does not match the exact candidate.",
    );
  requireValue(
    /^[a-zA-Z0-9_-]+$/u.test(receipt.actor ?? "") &&
      receipt.actor === expected.actor,
    "Evidence actor does not match the operator.",
  );
  const issued = timestamp(receipt.issuedAt);
  const expires = timestamp(receipt.expiresAt);
  requireValue(
    issued <= now &&
      expires > now &&
      expires > issued &&
      expires - issued <= dayMs,
    "Evidence is expired, future-dated, or exceeds 24 hours.",
  );
  const record = new URL(receipt.changeRecord);
  requireValue(
    record.origin === "https://github.com" &&
      !record.username &&
      !record.password &&
      !record.search &&
      !record.hash &&
      new RegExp(
        `^/${expected.repository.replaceAll(".", "\\.")}/(?:issues|pull)/[1-9][0-9]*$`,
        "u",
      ).test(record.pathname),
    "Evidence needs a change record in this repository.",
  );
  requireValue(
    Array.isArray(receipt.checks) &&
      receipt.checks.length === localValidationChecks.length,
    "Evidence is missing local checks.",
  );
  requireValue(
    new Set(receipt.checks.map((check) => check.name)).size ===
      localValidationChecks.length,
    "Evidence contains duplicate checks.",
  );
  for (const check of receipt.checks) {
    keys(check, ["name", "exitCode", "completedAt", "reportSha256"]);
    requireValue(
      localValidationChecks.includes(check.name) &&
        check.exitCode === 0 &&
        digest.test(check.reportSha256 ?? ""),
      "Evidence check is missing, unsuccessful, or has an invalid digest.",
    );
    const completed = timestamp(check.completedAt);
    requireValue(
      completed <= issued && issued - completed <= dayMs,
      "Evidence check is outside the candidate validation window.",
    );
    if (readReport)
      requireValue(
        createHash("sha256").update(readReport(check.name)).digest("hex") ===
          check.reportSha256,
        "Evidence report digest mismatch.",
      );
  }
  return {
    kind: "operator-local-validation",
    assurance:
      "Operator attestation. Candidate bindings and report digests checked; test execution is not independently proven.",
    releaseSha: receipt.releaseSha,
    acceptedSha: receipt.acceptedSha,
    gitTree: receipt.gitTree,
    privateGitlink: receipt.privateGitlink,
    actor: receipt.actor,
    expiresAt: receipt.expiresAt,
    changeRecord: receipt.changeRecord,
    checks: receipt.checks.map(({ name, reportSha256 }) => ({
      name,
      reportSha256,
    })),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const values = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      const name = process.argv[index];
      requireValue(
        [
          "--file",
          "--reports",
          "--release-sha",
          "--accepted-sha",
          "--actor",
        ].includes(name) &&
          process.argv[index + 1] &&
          !values.has(name),
        "Use --file, --reports, --release-sha, --accepted-sha and --actor once each.",
      );
      values.set(name, process.argv[index + 1]);
    }
    requireValue(values.size === 5, "All evidence arguments are required.");
    const git = (...args) =>
      execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const releaseSha = values.get("--release-sha");
    const acceptedSha = values.get("--accepted-sha");
    requireValue(
      sha.test(releaseSha) && sha.test(acceptedSha),
      "Full candidate SHAs are required.",
    );
    requireValue(
      [releaseSha, acceptedSha].includes(git("rev-parse", "HEAD")) &&
        !git("status", "--porcelain", "--untracked-files=normal"),
      "Use a clean checkout of the exact candidate.",
    );
    const gitTree = git("rev-parse", `${acceptedSha}^{tree}`);
    requireValue(
      git("rev-parse", `${releaseSha}^{tree}`) === gitTree,
      "Release and accepted trees differ.",
    );
    const privateGitlink = git(
      "rev-parse",
      `${acceptedSha}:lib/plugins/private`,
    );
    const bytes = readFileSync(values.get("--file"));
    requireValue(
      bytes.length <= 16384,
      "Evidence receipt exceeds its size limit.",
    );
    const result = verifyLocalValidationEvidence(
      JSON.parse(bytes.toString("utf8")),
      {
        releaseSha,
        acceptedSha,
        gitTree,
        privateGitlink,
        actor: values.get("--actor"),
        repository: "riddhimanrana/lets-assist",
      },
      {
        readReport: (name) =>
          readFileSync(resolve(values.get("--reports"), `${name}.log`)),
      },
    );
    console.log(
      JSON.stringify({
        ...result,
        receiptSha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
  } catch {
    console.error(
      "Local evidence verification failed. Check candidate identities, expiry, change record and sanitized report digests. No receipt contents were logged.",
    );
    process.exitCode = 1;
  }
}
