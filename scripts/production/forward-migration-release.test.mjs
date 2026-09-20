import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyForwardMigrations,
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import {
  prohibitedDataWrites,
  unreviewedWriteTables,
} from "./migration-data-writes.mjs";

// Keep the reviewed baseline fixed. Expected suffixes begin at that ledger
// boundary, so appending an approved migration does not move an older boundary.
const REVIEWED_PREFIX_LENGTH = 468;
const APPROVED_TAIL = [
  "20260909090522",
  "20260909090944",
  "20260909161331",
  "20260909163547",
  "20260909171733",
  "20260909173201",
  "20260909193538",
  "20260909193835",
  "20260909231613",
  "20260910004059",
  "20260910043037",
  "20260910043106",
  "20260910045040",
  "20260910090800",
  "20260910232532",
  "20260911101007",
  "20260911130443",
  "20260911143923",
  "20260911184253",
  "20260911192954",
  "20260911195446",
  "20260911201640",
  "20260911203901",
  "20260911210549",
  "20260911211201",
  "20260911212627",
  "20260911223137",
  "20260911223138",
  "20260911231213",
  "20260912002546",
  "20260912015112",
  "20260912015608",
  "20260912033551",
  "20260912064503",
  "20260913012424",
  "20260913015059",
  "20260913031445",
  "20260913053412",
  "20260913061610",
  "20260913070513",
  "20260913175928",
  "20260913191541",
  "20260913200500",
  "20260913202237",
  "20260914030902",
  "20260914033117",
  "20260914044610",
  "20260914062207",
  "20260914072729",
  "20260914080000",
  "20260914120000",
  "20260914130000",
  "20260914150000",
  "20260914160000",
  "20260914170000",
  "20260915015213",
  "20260915032757",
  "20260915050000",
  "20260915051000",
  "20260915051713",
  "20260915054936",
  "20260915060928",
  "20260915152825",
  "20260915153055",
  "20260915161000",
  "20260915161001",
  "20260915161554",
  "20260915183410",
  "20260915195501",
  "20260916000000",
  "20260916010000",
  "20260916040000",
  "20260916050000",
  "20260916055000",
  "20260916060000",
  "20260916070000",
  "20260916080000",
  "20260916090000",
  "20260917010000",
  "20260917010100",
  "20260917010200",
  "20260917010300",
  "20260917020000",
  "20260917020100",
  "20260917030000",
  "20260917030100",
  "20260917040000",
  "20260917050000",
  "20260917060000",
  "20260917070000",
  "20260917080000",
  "20260917090000",
  "20260917100000",
  "20260917110000",
  "20260917130000",
  "20260917140000",
  "20260917150000",
  "20260917160000",
  "20260917170000",
  "20260917180000",
  "20260917190000",
  "20260917200000",
  "20260917210000",
  "20260917220000",
  "20260917230000",
  "20260918000000",
  "20260918010000",
  "20260918011000",
  "20260918012000",
  "20260918013000",
  "20260918014000",
  "20260918015000",
  "20260918016000",
  "20260918020000",
  "20260918030000",
  "20260918040000",
  "20260918050000",
  "20260918060000",
  "20260918070000",
  "20260918080000",
  "20260918090000",
  "20260918100000",
  "20260918110000",
  "20260918120000",
  "20260918130000",
  "20260918140000",
  "20260918150000",
  "20260918160000",
  "20260918170000",
  "20260918180000",
  "20260918183000",
  "20260918235900",
  "20260919010000",
  "20260919020000",
  "20260919091727",
  "20260919095826",
  "20260919103635",
  "20260919114409",
  "20260919133902",
  "20260919143851",
  "20260919145700",
  "20260919155040",
  "20260919161514",
  "20260919161824",
  "20260919161847",
  "20260919172947",
  "20260919190000",
  "20260919200000",
  "20260919203000",
  "20260919210000",
  "20260919220000",
  "20260919230000",
  "20260919230001",
  "20260920010000",
  "20260920020000",
];

const cwd = resolve(import.meta.dirname, "../..");
const config = {
  cwd,
  projectRef: "fotdmeakexgrkronxlof",
  token: "synthetic-test-token",
};
const prepared = prepareMigration(cwd);
const rows = (versions) => versions.map((version) => ({ version }));

function transport({
  lost = false,
  rollback = false,
  drift = false,
  badAcl = false,
  badCatalog = false,
  enabledWorker = false,
  initialVersions = prepared.prefix,
} = {}) {
  const calls = [];
  let written = false;
  return {
    calls,
    fetch: async (url, options) => {
      const sql = JSON.parse(options.body).query;
      calls.push({ url, options, sql });
      assert.equal(options.redirect, "error");
      let result;
      if (url.endsWith("/database/query")) {
        written = true;
        if (lost) throw new Error("Synthetic response loss");
        result = [];
      } else if (sql.startsWith("SELECT version::text")) {
        result = rows(
          written && !rollback ? prepared.versions : initialVersions,
        );
        if (drift) result.pop();
      } else if (sql.includes("csf_target_schema_verified")) {
        result = [{ csf_target_schema_verified: badCatalog ? 0 : 1 }];
      } else {
        result = [
          {
            valid: !(
              (badAcl &&
                sql.includes("has_function_privilege('service_role'")) ||
              (enabledWorker &&
                sql.includes("WHERE workbook_refresh OR import_commit"))
            ),
          },
        ];
      }
      return { ok: true, json: async () => result };
    },
  };
}

test("approved bytes and exact versions share one transaction", () => {
  assert.equal(prepared.prefix.length, REVIEWED_PREFIX_LENGTH);
  assert.equal(
    prepared.versions.length,
    REVIEWED_PREFIX_LENGTH + APPROVED_TAIL.length,
  );
  assert.deepEqual(prepared.versions.slice(REVIEWED_PREFIX_LENGTH), [
    ...APPROVED_TAIL,
  ]);
  assert.match(prepared.query, /^BEGIN;/u);
  assert.match(prepared.query, /COMMIT;$/u);
  assert.match(
    prepared.query,
    /LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE/u,
  );
  assert.match(prepared.query, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(
    prepared.query,
    /INSERT INTO supabase_migrations.schema_migrations\(version,name,statements\)/u,
  );
  assert.match(
    prepared.query,
    /'20260909090522','csf_application_grade_preview_evidence'/u,
  );
  assert.match(
    prepared.query,
    /'20260909090944','csf_application_retry_match_recovery'/u,
  );
});

test("refuses modified approved SQL before any provider request", () => {
  for (const [name] of approvedMigrations) {
    const target = resolve(cwd, "supabase/migrations", `${name}.sql`);
    assert.throws(
      () =>
        prepareMigration(cwd, (path) => {
          const sql = readFileSync(path, "utf8");
          return path === target ? `${sql}\n` : sql;
        }),
      /bytes changed/u,
      name,
    );
    assert.ok(
      prepared.query.includes(`'${name.slice(0, 14)}','${name.slice(15)}'`),
    );
  }
});

test("performs one write and verifies ledger and permissions", async () => {
  const t = transport();
  const result = await applyForwardMigrations(config, t.fetch);
  assert.equal(result.migrations, prepared.versions.length);
  assert.equal(result.workers, "disabled");
  assert.equal(result.responseLost, false);
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
  );
  assert.ok(
    t.calls.every((call) => new URL(call.url).hostname === "api.supabase.com"),
  );
  assert.ok(!JSON.stringify(result).includes(config.token));
});

test("settles a lost response through reads without resending SQL", async () => {
  const t = transport({ lost: true });
  assert.equal(
    (await applyForwardMigrations(config, t.fetch)).responseLost,
    true,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
  );
});

test("a refused or rolled-back transaction remains unresolved without retry", async () => {
  const t = transport({ lost: true, rollback: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
  );
});

test("ledger drift stops before mutation", async () => {
  const t = transport({ drift: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /sequence differs/u,
  );
  assert.equal(t.calls.length, 1);
});

test("enabled workers stop before migration and are rechecked under a lock", async () => {
  const t = transport({ enabledWorker: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /enabled CSF worker/u,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    0,
  );
  assert.match(
    prepared.query,
    /LOCK TABLE app_private.csf_release_worker_controls IN SHARE MODE/u,
  );
  assert.match(
    prepared.query,
    /Disable CSF workers before applying schema changes/u,
  );
});

test("publication drain guards respect the applied schema boundary", () => {
  for (const count of [468, 513, 514, 515, 516, 517, 518]) {
    const migration = prepareMigration(
      cwd,
      readFileSync,
      prepared.versions.slice(0, count),
    );
    const guard = migration.query.slice(
      0,
      migration.query.indexOf("END $release_guard$;"),
    );
    assert.match(
      guard,
      /coalesce\(\(to_jsonb\(csf_release_worker_controls\)->>'publication_notifications'\)::boolean,false\)/u,
    );
    if (count < 514) {
      assert.doesNotMatch(guard, /csf_publication_notification_deliveries/u);
    } else {
      assert.match(
        guard,
        /LOCK TABLE plugin_data.csf_publication_notification_deliveries IN SHARE MODE/u,
      );
      assert.match(guard, /status='processing' AND lease_expires_at>now\(\)/u);
      assert.match(guard, /Wait for publication notification leases to drain/u);
    }
  }
});

test("wrong project refuses all provider access", async () => {
  const t = transport();
  await assert.rejects(
    applyForwardMigrations({ ...config, projectRef: "development" }, t.fetch),
    /binding/u,
  );
  assert.equal(t.calls.length, 0);
});

test("incorrect runtime ACL does not report completion", async () => {
  const t = transport({ badAcl: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
});

test("a matching ledger cannot hide a changed schema catalog", async () => {
  const t = transport({ badCatalog: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
  assert.equal(
    t.calls.filter((call) => call.url.endsWith("/database/query")).length,
    1,
  );
});

test("schema-only workflow has no build, import, backup, or worker mutation", () => {
  const workflow = readFileSync(
    resolve(cwd, ".github/workflows/deploy-forward-migrations.yml"),
    "utf8",
  );
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /production-schema-deployment/u);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/u);
  assert.match(workflow, /app-release-checks.mjs source/u);
  assert.doesNotMatch(
    workflow,
    /bun run build|vercel.*deploy|db (push|dump|reset)|csf_queue_import|set_csf_release_worker_control/u,
  );
});

test("a reviewed partially applied tail writes only the remaining migrations", async () => {
  const initialVersions = prepared.versions.slice(0, 478);
  const t = transport({ initialVersions });
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, [
    ...APPROVED_TAIL.slice(478 - REVIEWED_PREFIX_LENGTH),
  ]);
  const writes = t.calls.filter((call) => call.url.endsWith("/database/query"));
  assert.equal(writes.length, 1);
  assert.ok(
    writes[0].sql.includes(
      "'20260910043037','csf_reported_application_contacts'",
    ),
  );
  assert.ok(
    !writes[0].sql.includes(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_set_review_period",
    ),
  );
  assert.ok(
    writes[0].sql.includes(
      `ARRAY[${initialVersions.map((version) => `'${version}'`).join(",")}]::text[]`,
    ),
  );
  assert.equal(
    (
      writes[0].sql.match(
        /INSERT INTO supabase_migrations.schema_migrations/g,
      ) ?? []
    ).length,
    prepared.versions.length - 478,
  );
});

test("an already applied tail verifies the catalog without resending SQL", async () => {
  const t = transport({ initialVersions: prepared.versions });
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, []);
  assert.equal(result.responseLost, false);
  assert.equal(result.catalog, "verified");
  assert.ok(
    t.calls.some((call) => call.sql.includes("csf_target_schema_verified")),
  );
  assert.ok(t.calls.every((call) => call.url.endsWith("/read-only")));
});

test("an applied 522 ledger sends the reviewed schema and publication tail", async () => {
  const t = transport({ initialVersions: prepared.versions.slice(0, 522) });
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, [
    ...APPROVED_TAIL.slice(522 - REVIEWED_PREFIX_LENGTH),
  ]);
  const writes = t.calls.filter((call) => call.url.endsWith("/database/query"));
  assert.equal(writes.length, 1);
  assert.match(
    writes[0].sql,
    /'20260914170000','csf_application_import_noop_guard'/u,
  );
  assert.equal(
    (
      writes[0].sql.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 522,
  );
});

test("an applied 523 ledger sends the mixed-category fix and publication", async () => {
  const t = transport({ initialVersions: prepared.versions.slice(0, 523) });
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, [
    ...APPROVED_TAIL.slice(523 - REVIEWED_PREFIX_LENGTH),
  ]);
  const writes = t.calls.filter((call) => call.url.endsWith("/database/query"));
  assert.equal(writes.length, 1);
  assert.match(
    writes[0].sql,
    /'20260915015213','csf_mixed_category_point_resubmission'/u,
  );
  assert.equal(
    (
      writes[0].sql.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 523,
  );
});

test("an applied 524 ledger sends the signed publication and reviewed guards", async () => {
  const t = transport({ initialVersions: prepared.versions.slice(0, 524) });
  const result = await applyForwardMigrations(config, t.fetch);
  assert.deepEqual(result.applied, [
    ...APPROVED_TAIL.slice(524 - REVIEWED_PREFIX_LENGTH),
  ]);
  const writes = t.calls.filter((call) => call.url.endsWith("/database/query"));
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /'20260915032757','publish_dvhs_csf_1_2_46'/u);
  assert.equal(
    (
      writes[0].sql.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 524,
  );
  assert.doesNotMatch(
    writes[0].sql,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an already applied tail still refuses catalog drift", async () => {
  const t = transport({ initialVersions: prepared.versions, badCatalog: true });
  await assert.rejects(
    applyForwardMigrations(config, t.fetch),
    /reconciliation/u,
  );
  assert.ok(t.calls.every((call) => call.url.endsWith("/read-only")));
});

test("only exact reviewed prefixes may skip approved migrations", async () => {
  for (const initialVersions of [
    [...prepared.versions, "20990101000000"],
    prepared.versions.slice(0, 467),
    [...prepared.versions.slice(0, 476), "20990101000000"],
    [
      ...prepared.versions.slice(0, 475),
      prepared.versions[476],
      prepared.versions[475],
    ],
  ]) {
    const t = transport({ initialVersions });
    await assert.rejects(
      applyForwardMigrations(config, t.fetch),
      /sequence differs/u,
    );
    assert.equal(t.calls.length, 1);
  }
});

test("an applied 508 ledger adds the signed publications and discussion write guard", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 508),
  );
  assert.equal(publication.versions.length, prepared.versions.length);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 508,
  );
  assert.ok(
    publication.query.includes("'20260913175928','publish_dvhs_csf_1_2_40'"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.39'"));
  assert.match(
    publication.query,
    /CREATE OR REPLACE FUNCTION plugin_data.csf_add_sheet_sync_local_message/u,
  );
});

test("an applied 509 ledger adds the signed publications and discussion write guard", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 509),
  );
  assert.equal(publication.versions.length, prepared.versions.length);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 509,
  );
  assert.ok(
    publication.query.includes("'20260913191541','publish_dvhs_csf_1_2_41'"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.40'"));
  assert.match(
    publication.query,
    /CREATE OR REPLACE FUNCTION plugin_data.csf_add_sheet_sync_local_message/u,
  );
});

test("an applied 510 ledger adds the discussion writer guard and signed publications", () => {
  const migration = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 510),
  );
  assert.equal(migration.versions.length, prepared.versions.length);
  assert.equal(
    (
      migration.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 510,
  );
  assert.ok(
    migration.query.includes(
      "'20260913200500','csf_sheet_discussion_write_guard'",
    ),
  );
  assert.match(
    migration.query,
    /REVOKE ALL ON FUNCTION plugin_data.csf_add_sheet_sync_local_message/u,
  );
  assert.match(
    migration.query,
    /Sheet discussions are disabled for this destination/u,
  );
  assert.ok(migration.query.includes("AND latest_version = '1.2.41'"));
});

test("an applied 511 ledger adds the signed publications and notification delivery", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 511),
  );
  assert.equal(publication.versions.length, prepared.versions.length);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 511,
  );
  assert.ok(
    publication.query.includes("'20260913202237','publish_dvhs_csf_1_2_42'"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.41'"));
  assert.match(
    publication.query,
    /CREATE FUNCTION plugin_data.csf_record_publication_notifications/u,
  );
});

test("an applied 512 ledger adds the signed 1.2.43 publication and notification delivery", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 512),
  );
  assert.equal(publication.versions.length, prepared.versions.length);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 512,
  );
  assert.ok(
    publication.query.includes("'20260914030902','publish_dvhs_csf_1_2_43'"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.42'"));
  assert.ok(publication.query.includes("'20260913200500'"));
  assert.match(
    publication.query,
    /CREATE FUNCTION plugin_data.csf_record_publication_notifications/u,
  );
  assert.deepEqual(unreviewedWriteTables(publication.query), []);
  assert.deepEqual(prohibitedDataWrites(publication.query), []);
});

test("an applied 513 ledger adds only gated publication delivery and generic preferences", () => {
  const notification = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 513),
  );
  assert.equal(notification.versions.length, prepared.versions.length);
  assert.equal(
    (
      notification.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 513,
  );
  assert.ok(
    notification.query.includes(
      "'20260914033117','csf_publication_notifications'",
    ),
  );
  assert.match(notification.query, /organization_plugin_access/u);
  assert.match(
    notification.query,
    /CREATE FUNCTION plugin_data.csf_record_publication_notifications/u,
  );
  assert.deepEqual(unreviewedWriteTables(notification.query), []);
  assert.deepEqual(prohibitedDataWrites(notification.query), []);
});

test("an applied 515 ledger adds the reviewed release tail", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 515),
  );
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 515,
  );
  assert.ok(
    publication.query.includes("'20260914062207','publish_dvhs_csf_1_2_44'"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.43'"));
  assert.ok(
    publication.query.includes("c2cfe6bee781c5d94c4fab0c05b62d0134e5f8ae"),
  );
  assert.ok(
    publication.query.includes(
      "required_platform_schema_version IS DISTINCT FROM '20260914033117'",
    ),
  );
  assert.ok(
    publication.query.includes("runtime_profile IS DISTINCT FROM 'embedded'"),
  );
  assert.match(publication.query, /csf_flexible_activity_earning_rules/u);
  assert.doesNotMatch(
    publication.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 516 ledger adds the signed publication and reviewed schema tail", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 516),
  );
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 516,
  );
  assert.ok(
    publication.query.includes("'20260914072729','publish_dvhs_csf_1_2_45'"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.44'"));
  assert.ok(
    publication.query.includes("135bfa3a3c1bc7b2d1608fec215c517631380c49"),
  );
  assert.ok(
    publication.query.includes(
      "required_platform_schema_version IS DISTINCT FROM '20260914033117'",
    ),
  );
  assert.ok(
    publication.query.includes("runtime_profile IS DISTINCT FROM 'embedded'"),
  );
  assert.match(publication.query, /csf_manual_application_intake/u);
  assert.doesNotMatch(
    publication.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 517 ledger applies the grant reset and reviewed schema tail", () => {
  const migration = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 517),
  );
  assert.equal(
    (
      migration.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 517,
  );
  assert.match(
    migration.query,
    /FROM PUBLIC, anon, authenticated, service_role/u,
  );
  assert.match(migration.query, /TO postgres, service_role/u);
  assert.match(
    migration.query,
    /CREATE OR REPLACE FUNCTION plugin_data\.csf_set_application_intake/u,
  );
});

test("an applied 530 ledger writes the reviewed audit migrations and signed publication", () => {
  const migration = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 530),
  );
  assert.deepEqual(migration.versions.slice(530), [
    ...APPROVED_TAIL.slice(530 - REVIEWED_PREFIX_LENGTH),
  ]);
  assert.equal(
    (
      migration.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 530,
  );
  assert.ok(migration.query.includes("csf_history_import_review_guards"));
  assert.ok(migration.query.includes("csf_connection_request_identity_guards"));
  assert.ok(migration.query.includes("csf_fixed_activity_cap_guard"));
});

test("an applied 533 ledger writes the signed publication and recovery guard", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 533),
  );
  assert.deepEqual(publication.versions.slice(533), [
    ...APPROVED_TAIL.slice(533 - REVIEWED_PREFIX_LENGTH),
  ]);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 533,
  );
  assert.ok(
    publication.query.includes("'20260915161001','publish_dvhs_csf_1_2_49'"),
  );
  assert.ok(
    publication.query.includes("deb220b48422507f6a406c0911433577a0c08391"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.48'"));
  assert.match(
    publication.query,
    /CREATE OR REPLACE FUNCTION plugin_data.csf_join_class_by_code_identity_base/u,
  );
  assert.doesNotMatch(
    publication.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 534 ledger writes the reviewed recovery and publication", () => {
  const recovery = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 534),
  );
  assert.deepEqual(recovery.versions.slice(534), [
    ...APPROVED_TAIL.slice(534 - REVIEWED_PREFIX_LENGTH),
  ]);
  assert.equal(
    (
      recovery.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 534,
  );
  assert.ok(
    recovery.query.includes(
      "'20260915161554','csf_resolved_class_request_recovery'",
    ),
  );
  assert.match(
    recovery.query,
    /IF v_existing_request_status IN \('auto_linked', 'resolved'\) THEN/u,
  );
  assert.match(recovery.query, /FROM PUBLIC,anon,authenticated,service_role/u);
  assert.match(recovery.query, /INSERT INTO public\.plugin_versions/u);
  assert.doesNotMatch(
    recovery.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 535 ledger writes the signed publications and the typed-name and report migrations", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 535),
  );
  assert.deepEqual(publication.versions.slice(535), [
    ...APPROVED_TAIL.slice(535 - REVIEWED_PREFIX_LENGTH),
  ]);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 535,
  );
  assert.ok(
    publication.query.includes("'20260915183410','publish_dvhs_csf_1_2_50'"),
  );
  assert.ok(
    publication.query.includes("1726e639955c3259ce7565879fd3195a369fb3c3"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.49'"));
  assert.doesNotMatch(
    publication.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 536 ledger writes the signed 1.2.51 publication and the typed-name and report migrations", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 536),
  );
  assert.deepEqual(publication.versions.slice(536), [
    ...APPROVED_TAIL.slice(536 - REVIEWED_PREFIX_LENGTH),
  ]);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 536,
  );
  assert.ok(
    publication.query.includes("'20260915195501','publish_dvhs_csf_1_2_51'"),
  );
  assert.ok(
    publication.query.includes("acc5e10640c57bda8856e966ebbc017b78365cc5"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.50'"));
  assert.doesNotMatch(
    publication.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 604 ledger writes the signed publication and later repairs", () => {
  const publication = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 604),
  );
  assert.deepEqual(publication.versions.slice(604), [
    "20260919103635",
    "20260919114409",
    "20260919133902",
    "20260919143851",
    "20260919145700",
    "20260919155040",
    "20260919161514",
    "20260919161824",
    "20260919161847",
    "20260919172947",
    "20260919190000",
    "20260919200000",
    "20260919203000",
    "20260919210000",
    "20260919220000",
    "20260919230000",
    "20260919230001",
    "20260920010000",
    "20260920020000",
  ]);
  assert.equal(
    (
      publication.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 604,
  );
  assert.ok(
    publication.query.includes("'20260919103635','publish_dvhs_csf_1_2_53'"),
  );
  assert.ok(
    publication.query.includes("11d3f531b4b74ef9dd0a3a332604a4c80b835448"),
  );
  assert.ok(publication.query.includes("AND latest_version = '1.2.51'"));
  assert.ok(
    publication.query.includes(
      "'20260919114409','serialize_csf_atomic_post_attachment_update'",
    ),
  );
  assert.ok(
    publication.query.includes(
      "'20260919133902','bind_csf_post_publication_requests'",
    ),
  );
  assert.ok(
    publication.query.includes(
      "'20260919143851','bind_csf_publication_recovery_to_receipt'",
    ),
  );
  assert.doesNotMatch(
    publication.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 605 ledger writes the remaining post and cleanup repairs", () => {
  const repair = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 605),
  );
  assert.deepEqual(repair.versions.slice(605), [
    "20260919114409",
    "20260919133902",
    "20260919143851",
    "20260919145700",
    "20260919155040",
    "20260919161514",
    "20260919161824",
    "20260919161847",
    "20260919172947",
    "20260919190000",
    "20260919200000",
    "20260919203000",
    "20260919210000",
    "20260919220000",
    "20260919230000",
    "20260919230001",
    "20260920010000",
    "20260920020000",
  ]);
  assert.equal(
    (
      repair.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 605,
  );
  assert.ok(
    repair.query.includes(
      "'20260919114409','serialize_csf_atomic_post_attachment_update'",
    ),
  );
  assert.ok(
    repair.query.includes(
      "'20260919133902','bind_csf_post_publication_requests'",
    ),
  );
  assert.ok(
    repair.query.includes(
      "'20260919143851','bind_csf_publication_recovery_to_receipt'",
    ),
  );
  assert.doesNotMatch(
    repair.query,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.organization_plugin_installs/u,
  );
});

test("an applied 606 ledger writes publication binding and cleanup repairs", () => {
  const binding = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 606),
  );
  assert.deepEqual(binding.versions.slice(606), [
    "20260919133902",
    "20260919143851",
    "20260919145700",
    "20260919155040",
    "20260919161514",
    "20260919161824",
    "20260919161847",
    "20260919172947",
    "20260919190000",
    "20260919200000",
    "20260919203000",
    "20260919210000",
    "20260919220000",
    "20260919230000",
    "20260919230001",
    "20260920010000",
    "20260920020000",
  ]);
  assert.equal(
    (
      binding.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 606,
  );
  assert.ok(
    binding.query.includes(
      "'20260919133902','bind_csf_post_publication_requests'",
    ),
  );
  assert.ok(
    binding.query.includes(
      "'20260919143851','bind_csf_publication_recovery_to_receipt'",
    ),
  );
});

test("an applied 607 ledger writes recovery and Storage cleanup guards", () => {
  const recovery = prepareMigration(
    cwd,
    readFileSync,
    prepared.versions.slice(0, 607),
  );
  assert.deepEqual(recovery.versions.slice(607), [
    "20260919143851",
    "20260919145700",
    "20260919155040",
    "20260919161514",
    "20260919161824",
    "20260919161847",
    "20260919172947",
    "20260919190000",
    "20260919200000",
    "20260919203000",
    "20260919210000",
    "20260919220000",
    "20260919230000",
    "20260919230001",
    "20260920010000",
    "20260920020000",
  ]);
  assert.equal(
    (
      recovery.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    prepared.versions.length - 607,
  );
  assert.ok(
    recovery.query.includes(
      "'20260919143851','bind_csf_publication_recovery_to_receipt'",
    ),
  );
  assert.ok(
    recovery.query.includes(
      "'20260919145700','csf_storage_deletion_claim_boundary'",
    ),
  );
  assert.ok(
    recovery.query.includes(
      "'20260919155040','csf_two_phase_storage_teardown'",
    ),
  );
});
