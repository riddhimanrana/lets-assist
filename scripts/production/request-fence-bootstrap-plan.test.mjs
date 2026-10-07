import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { after } from "node:test";
import {
  bootstrapPlan,
  bootstrapMutationSql,
  bootstrapVerificationSql,
  bootstrapFilename,
} from "./request-fence-bootstrap-plan.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { generateFinalSchemaManifest } from "./generate-final-schema-manifest.mjs";
import { finalSchemaCatalog, ledgerDigest } from "./final-schema-manifest.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { migrationDigests } from "./migration-digests.mjs";
const repository = resolve(import.meta.dirname, "../..");
const cwd = mkdtempSync(resolve(tmpdir(), "request-fence-bootstrap-"));
mkdirSync(resolve(cwd, "supabase/migrations"), { recursive: true });
const names = readdirSync(resolve(repository, "supabase/migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort()
  .slice(0, 688);
for (const name of names)
  symlinkSync(
    resolve(repository, "supabase/migrations", name),
    resolve(cwd, "supabase/migrations", name),
  );
after(() => rmSync(cwd, { recursive: true, force: true }));
const versions = names.map((name) => name.slice(0, 14));
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-688.json", import.meta.url), "utf8"),
);
const previous = JSON.parse(
  readFileSync(new URL("./final-schema-687.json", import.meta.url), "utf8"),
);

test("observed bootstrap accepts only exact688 and preserves historical687", () => {
  assert.equal(versions.at(-1), "20260929051600");
  assert.equal(ledgerDigest(versions), manifest.ledger);
  assert.equal(
    acceptedCatalogQuery("", versions),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(manifest, versions)),
  );
  assert.equal(
    acceptedCatalogQuery("", versions.slice(0, 687)),
    csfSubmissionDeletionCatalog(
      finalSchemaCatalog(previous, versions.slice(0, 687)),
    ),
  );
  assert.deepEqual(
    manifest,
    generateFinalSchemaManifest(versions, manifest.objects),
  );
  const added = manifest.objects.filter(
    (row) => !previous.objects.some((old) => old.identity === row.identity),
  );
  assert.deepEqual(
    added.map((row) => row.identity),
    ["function:public.enforce_application_request_write_fence()"],
  );
  assert.deepEqual(
    manifest.objects.filter((row) => row !== added[0]),
    previous.objects,
  );
  for (const bad of [
    [...versions, "20990101000000"],
    [...versions.slice(0, -1), "20990101000000"],
    [...versions.slice(0, -2), ...versions.slice(-2).reverse()],
  ])
    assert.throws(
      () => acceptedCatalogQuery("", bad),
      /explicit release review/u,
    );
});

test("bootstrap plan pins every real migration and exact new bytes", () => {
  const plan = bootstrapPlan(cwd);
  assert.equal(plan.before.length, 687);
  assert.equal(plan.after.length, 688);
  assert.equal(
    createHash("sha256").update(plan.sql).digest("hex"),
    migrationDigests[bootstrapFilename],
  );
  assert.throws(
    () =>
      bootstrapPlan(cwd, (path, ...args) =>
        path.endsWith(bootstrapFilename)
          ? readFileSync(path, ...args) + "\n-- changed"
          : readFileSync(path, ...args),
      ),
    /not reviewed/u,
  );
  const extra = resolve(
    cwd,
    "supabase/migrations/20990101000000_unreviewed.sql",
  );
  try {
    writeFileSync(extra, "SELECT 1;");
    assert.deepEqual(bootstrapPlan(cwd), plan);
    assert.ok(
      !bootstrapMutationSql(bootstrapPlan(cwd)).includes("20990101000000"),
    );
  } finally {
    rmSync(extra);
  }
});

test("atomic bootstrap locks and verifies before installing one ledger row", () => {
  const plan = bootstrapPlan(cwd),
    sql = bootstrapMutationSql(plan);
  assert.ok(sql.startsWith("BEGIN ISOLATION LEVEL READ COMMITTED;"));
  assert.ok(
    sql.indexOf("pg_advisory_xact_lock(592043,1)") <
      sql.indexOf(
        "CREATE FUNCTION public.enforce_application_request_write_fence",
      ),
  );
  assert.ok(
    sql.indexOf("LOCK TABLE supabase_migrations.schema_migrations") <
      sql.indexOf(
        "CREATE FUNCTION public.enforce_application_request_write_fence",
      ),
  );
  assert.equal(
    (sql.match(/INSERT INTO supabase_migrations.schema_migrations/gu) || [])
      .length,
    1,
  );
  assert.ok(sql.indexOf("COMMIT;") < sql.indexOf("DO $request_barrier$"));
  assert.ok(sql.includes("SELECT 'request-fence-bootstrap-applied'"));
  assert.ok(!sql.includes("pg_terminate_backend"));
  const check = bootstrapVerificationSql(plan.after);
  for (const setting of [
    "default_transaction_read_only",
    "pgrst.db_pre_config",
    "pgrst.app_settings.maintenance_write_block",
  ])
    assert.ok(check.includes(setting));
  assert.ok(check.includes("routine.provolatile = 'v'"));
});
