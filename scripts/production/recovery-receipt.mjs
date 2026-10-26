import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { productionRef, ReleaseCheckError } from "./app-release-checks.mjs";

// The release accepts one of two recovery receipts, and the names say which:
// - recovery-capture-verified:<sha>:<manifest sha256> is the full
//   post-quiescence capture with restore and Storage checks.
// - managed-backup-accepted:<sha>:<record sha256> is the operator accepting
//   an existing Supabase daily physical backup as the restore point. Writes
//   made after that backup are not in it; the record names its time so the
//   recovery point is explicit. The workflow verifies the backup exists.

const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};

const sha = /^[a-f0-9]{40}$/u;
const digest = /^[a-f0-9]{64}$/u;
const backupTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u;
// A daily backup older than this cannot be the release recovery point.
const maximumBackupAgeMs = 36 * 60 * 60 * 1000;

export function managedBackupRecord(insertedAt) {
  requireCondition(
    backupTime.test(insertedAt ?? ""),
    "The managed backup time must be an exact UTC timestamp.",
  );
  return `managed-physical-backup:${productionRef}:${new Date(insertedAt).toISOString()}`;
}

export const managedBackupDigest = (insertedAt) =>
  createHash("sha256").update(managedBackupRecord(insertedAt)).digest("hex");

export function recoveryReceipt(env) {
  const source = env.GITHUB_SHA;
  const value = env.RECOVERY_CAPTURE_SHA256;
  const confirmation = env.RECOVERY_CAPTURE_CONFIRMATION;
  requireCondition(
    sha.test(source ?? "") && digest.test(value ?? ""),
    "The recovery receipt needs the exact release SHA and a SHA-256 value.",
  );
  if (confirmation === `recovery-capture-verified:${source}:${value}`)
    return { mode: "capture", sha256: value };
  if (confirmation === `managed-backup-accepted:${source}:${value}`) {
    requireCondition(
      value === managedBackupDigest(env.MANAGED_BACKUP_INSERTED_AT),
      "The managed backup receipt does not match the named backup time.",
    );
    return {
      mode: "managed-backup",
      sha256: value,
      insertedAt: new Date(env.MANAGED_BACKUP_INSERTED_AT).toISOString(),
    };
  }
  throw new ReleaseCheckError(
    "The recovery receipt is not bound to this release SHA and value.",
  );
}

// Managed backup accepts an older restore point; authorize this run to block.
// A full post-quiescence capture still attests that blocking preceded capture.
export function writeBlockAuthorization(env, receipt = recoveryReceipt(env)) {
  const expected = `${receipt.mode === "managed-backup" ? "block-application-writes" : "application-writes-blocked"}:${env.GITHUB_SHA}`;
  requireCondition(
    env.APPLICATION_WRITES_BLOCKED_CONFIRMATION === expected,
    "The application write-block authorization is not bound to this recovery mode and source.",
  );
  return expected;
}

// Reads the Management API backup list and refuses unless the named backup is
// a completed physical backup of this project taken within the age bound.
export async function verifyManagedBackup({
  insertedAt,
  token,
  now = Date.now(),
  fetcher = fetch,
}) {
  managedBackupRecord(insertedAt);
  const named = new Date(insertedAt);
  requireCondition(
    typeof token === "string" && token.trim(),
    "The Management API token is unavailable.",
  );
  let body;
  try {
    const response = await fetcher(
      `https://api.supabase.com/v1/projects/${productionRef}/database/backups`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    requireCondition(response.ok, "The backup list request was refused.");
    body = await response.json();
  } catch (error) {
    if (error instanceof ReleaseCheckError) throw error;
    throw new ReleaseCheckError("The backup list could not be read.");
  }
  requireCondition(
    Array.isArray(body?.backups),
    "The backup list has an unexpected shape.",
  );
  const matches = body.backups.filter(
    (backup) =>
      typeof backup?.inserted_at === "string" &&
      new Date(backup.inserted_at).getTime() === named.getTime(),
  );
  requireCondition(
    matches.length === 1 &&
      matches[0].is_physical_backup === true &&
      matches[0].status === "COMPLETED",
    "The named backup is not one completed physical backup of this project.",
  );
  const age = now - named.getTime();
  requireCondition(
    age >= 0 && age <= maximumBackupAgeMs,
    "The named backup is outside the release age bound.",
  );
  return {
    insertedAt: named.toISOString(),
    ageMinutes: Math.floor(age / 60_000),
    pitrEnabled: body.pitr_enabled === true,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const receipt = recoveryReceipt(process.env);
    writeBlockAuthorization(process.env, receipt);
    if (receipt.mode === "managed-backup") {
      const verified = await verifyManagedBackup({
        insertedAt: receipt.insertedAt,
        token: process.env.SUPABASE_ACCESS_TOKEN,
      });
      process.stdout.write(
        `${JSON.stringify({ mode: receipt.mode, ...verified })}\n`,
      );
    } else process.stdout.write(`${JSON.stringify({ mode: receipt.mode })}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof ReleaseCheckError ? error.message : "The recovery receipt check failed."}\n`,
    );
    process.exitCode = 1;
  }
}
