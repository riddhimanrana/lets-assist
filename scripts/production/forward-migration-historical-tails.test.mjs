import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { historicalReleaseTestFixture } from "./historical-release-test-fixture.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";

const fixture = historicalReleaseTestFixture();
const cwd = fixture.cwd;
after(fixture.dispose);
const prepared = prepareMigration(cwd);

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
    "20260920030000",
    "20260920030001",
    "20260920042000",
    "20260920062528",
    "20260920080000",
    "20260920180915",
    "20260920181255",
    "20260920181754",
    "20260920214013",
    "20260920233000",
    "20260920233100",
    "20260920233200",
    "20260921015005",
    "20260921020000",
    "20260921020100",
    "20260921051524",
    "20260921065123",
    "20260921073532",
    "20260921074528",
    "20260921074847",
    "20260921235401",
    "20260922003000",
    "20260922030507",
    "20260922032811",
    "20260922054000",
    "20260922054001",
    "20260922081309",
    "20260922094708",
    "20260922105553",
    "20260922112314",
    "20260922124643",
    "20260922135905",
    "20260922181458",
    "20260922232103",
    "20260923001620",
    "20260923005225",
    "20260923011054",
    "20260923011212",
    "20260923013334",
    "20260923033000",
    "20260923033010",
    "20260923033020",
    "20260923044405",
    "20260923200000",
    "20260923202633",
    "20260924033800",
    "20260924034832",
    "20260924034956",
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
    "20260920030000",
    "20260920030001",
    "20260920042000",
    "20260920062528",
    "20260920080000",
    "20260920180915",
    "20260920181255",
    "20260920181754",
    "20260920214013",
    "20260920233000",
    "20260920233100",
    "20260920233200",
    "20260921015005",
    "20260921020000",
    "20260921020100",
    "20260921051524",
    "20260921065123",
    "20260921073532",
    "20260921074528",
    "20260921074847",
    "20260921235401",
    "20260922003000",
    "20260922030507",
    "20260922032811",
    "20260922054000",
    "20260922054001",
    "20260922081309",
    "20260922094708",
    "20260922105553",
    "20260922112314",
    "20260922124643",
    "20260922135905",
    "20260922181458",
    "20260922232103",
    "20260923001620",
    "20260923005225",
    "20260923011054",
    "20260923011212",
    "20260923013334",
    "20260923033000",
    "20260923033010",
    "20260923033020",
    "20260923044405",
    "20260923200000",
    "20260923202633",
    "20260924033800",
    "20260924034832",
    "20260924034956",
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
    "20260920030000",
    "20260920030001",
    "20260920042000",
    "20260920062528",
    "20260920080000",
    "20260920180915",
    "20260920181255",
    "20260920181754",
    "20260920214013",
    "20260920233000",
    "20260920233100",
    "20260920233200",
    "20260921015005",
    "20260921020000",
    "20260921020100",
    "20260921051524",
    "20260921065123",
    "20260921073532",
    "20260921074528",
    "20260921074847",
    "20260921235401",
    "20260922003000",
    "20260922030507",
    "20260922032811",
    "20260922054000",
    "20260922054001",
    "20260922081309",
    "20260922094708",
    "20260922105553",
    "20260922112314",
    "20260922124643",
    "20260922135905",
    "20260922181458",
    "20260922232103",
    "20260923001620",
    "20260923005225",
    "20260923011054",
    "20260923011212",
    "20260923013334",
    "20260923033000",
    "20260923033010",
    "20260923033020",
    "20260923044405",
    "20260923200000",
    "20260923202633",
    "20260924033800",
    "20260924034832",
    "20260924034956",
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
    "20260920030000",
    "20260920030001",
    "20260920042000",
    "20260920062528",
    "20260920080000",
    "20260920180915",
    "20260920181255",
    "20260920181754",
    "20260920214013",
    "20260920233000",
    "20260920233100",
    "20260920233200",
    "20260921015005",
    "20260921020000",
    "20260921020100",
    "20260921051524",
    "20260921065123",
    "20260921073532",
    "20260921074528",
    "20260921074847",
    "20260921235401",
    "20260922003000",
    "20260922030507",
    "20260922032811",
    "20260922054000",
    "20260922054001",
    "20260922081309",
    "20260922094708",
    "20260922105553",
    "20260922112314",
    "20260922124643",
    "20260922135905",
    "20260922181458",
    "20260922232103",
    "20260923001620",
    "20260923005225",
    "20260923011054",
    "20260923011212",
    "20260923013334",
    "20260923033000",
    "20260923033010",
    "20260923033020",
    "20260923044405",
    "20260923200000",
    "20260923202633",
    "20260924033800",
    "20260924034832",
    "20260924034956",
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
