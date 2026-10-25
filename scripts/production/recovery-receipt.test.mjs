import assert from "node:assert/strict";
import test from "node:test";
import { productionRef } from "./app-release-checks.mjs";
import {
  managedBackupDigest,
  managedBackupRecord,
  recoveryReceipt,
  verifyManagedBackup,
} from "./recovery-receipt.mjs";

const source = "a".repeat(40);
const at = "2026-10-25T12:34:14Z";
const digest = managedBackupDigest(at);
const env = (overrides = {}) => ({
  GITHUB_SHA: source,
  RECOVERY_CAPTURE_SHA256: digest,
  RECOVERY_CAPTURE_CONFIRMATION: `managed-backup-accepted:${source}:${digest}`,
  MANAGED_BACKUP_INSERTED_AT: at,
  ...overrides,
});

test("the managed backup record names the project and the exact time", () => {
  assert.equal(
    managedBackupRecord(at),
    `managed-physical-backup:${productionRef}:2026-10-25T12:34:14.000Z`,
  );
  assert.match(digest, /^[a-f0-9]{64}$/u);
  for (const bad of [
    "",
    "2026-10-25 12:34:14",
    "2026-10-25T12:34:14+00:00",
    undefined,
  ])
    assert.throws(() => managedBackupRecord(bad), /exact UTC timestamp/u);
});

test("both receipt forms bind the release SHA, and nothing else passes", () => {
  const capture = "c".repeat(64);
  assert.deepEqual(
    recoveryReceipt({
      GITHUB_SHA: source,
      RECOVERY_CAPTURE_SHA256: capture,
      RECOVERY_CAPTURE_CONFIRMATION: `recovery-capture-verified:${source}:${capture}`,
    }),
    { mode: "capture", sha256: capture },
  );
  assert.deepEqual(recoveryReceipt(env()), {
    mode: "managed-backup",
    sha256: digest,
    insertedAt: "2026-10-25T12:34:14.000Z",
  });
  for (const [overrides, message] of [
    [
      {
        RECOVERY_CAPTURE_CONFIRMATION: `managed-backup-accepted:${"b".repeat(40)}:${digest}`,
      },
      /not bound/u,
    ],
    [
      {
        RECOVERY_CAPTURE_CONFIRMATION: `managed-backup-accepted:${source}:${"d".repeat(64)}`,
      },
      /not bound/u,
    ],
    [
      {
        RECOVERY_CAPTURE_CONFIRMATION: `recovery-capture-accepted:${source}:${digest}`,
      },
      /not bound/u,
    ],
    [
      { MANAGED_BACKUP_INSERTED_AT: "2026-10-24T12:34:20Z" },
      /does not match the named backup time/u,
    ],
    [{ MANAGED_BACKUP_INSERTED_AT: "" }, /exact UTC timestamp/u],
    [{ RECOVERY_CAPTURE_SHA256: "XYZ" }, /SHA-256 value/u],
    [{ GITHUB_SHA: "main" }, /exact release SHA/u],
  ])
    assert.throws(() => recoveryReceipt(env(overrides)), message);
});

const now = Date.parse("2026-10-25T21:00:00Z");
const reply =
  (body, ok = true) =>
  async (url, options) => {
    assert.equal(
      url,
      `https://api.supabase.com/v1/projects/${productionRef}/database/backups`,
    );
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer token-x");
    return { ok, json: async () => body };
  };
const backup = (overrides = {}) => ({
  is_physical_backup: true,
  status: "COMPLETED",
  inserted_at: "2026-10-25T12:34:14.000Z",
  ...overrides,
});

test("the named completed physical backup verifies, with its age and PITR state", async () => {
  assert.deepEqual(
    await verifyManagedBackup({
      insertedAt: at,
      token: "token-x",
      now,
      fetcher: reply({
        pitr_enabled: false,
        backups: [backup({ inserted_at: "2026-10-24T12:34:20Z" }), backup()],
      }),
    }),
    {
      insertedAt: "2026-10-25T12:34:14.000Z",
      ageMinutes: 505,
      pitrEnabled: false,
    },
  );
});

test("the API time with milliseconds is the only time that matches", async () => {
  const exact = "2026-10-25T12:34:14.676Z";
  const fetcher = reply({ backups: [backup({ inserted_at: exact })] });
  assert.equal(
    (
      await verifyManagedBackup({
        insertedAt: exact,
        token: "token-x",
        now,
        fetcher,
      })
    ).insertedAt,
    exact,
  );
  // The dashboard's whole-second time is a different instant and is refused.
  await assert.rejects(
    verifyManagedBackup({
      insertedAt: "2026-10-25T12:34:14Z",
      token: "token-x",
      now,
      fetcher,
    }),
    /not one completed physical backup/u,
  );
  assert.notEqual(
    managedBackupDigest(exact),
    managedBackupDigest("2026-10-25T12:34:14Z"),
  );
});

test("the backup check fails closed on every mismatch", async () => {
  for (const [fetcher, message, options = {}] of [
    [reply({ backups: [] }), /not one completed physical backup/u],
    [
      reply({ backups: [backup({ status: "FAILED" })] }),
      /not one completed physical backup/u,
    ],
    [
      reply({ backups: [backup({ is_physical_backup: false })] }),
      /not one completed physical backup/u,
    ],
    [
      reply({ backups: [backup(), backup()] }),
      /not one completed physical backup/u,
    ],
    [
      reply({ backups: [backup({ inserted_at: "2026-10-25T12:34:15Z" })] }),
      /not one completed physical backup/u,
    ],
    [reply({ data: [] }), /unexpected shape/u],
    [reply({}, false), /request was refused/u],
    [
      async () => {
        throw new Error("network");
      },
      /could not be read/u,
    ],
    [
      reply({ backups: [backup()] }),
      /outside the release age bound/u,
      { now: Date.parse("2026-10-27T01:00:00Z") },
    ],
    [
      reply({ backups: [backup()] }),
      /outside the release age bound/u,
      { now: Date.parse("2026-10-25T12:00:00Z") },
    ],
    [reply({ backups: [backup()] }), /token is unavailable/u, { token: "" }],
  ])
    await assert.rejects(
      verifyManagedBackup({
        insertedAt: at,
        token: "token-x",
        now,
        fetcher,
        ...options,
      }),
      message,
    );
});
