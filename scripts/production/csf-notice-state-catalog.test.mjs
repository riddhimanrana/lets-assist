import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-632.json"));
const after = JSON.parse(read("./final-schema-633.json"));
const ledger = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 633);
const old = new Map(before.objects.map((row) => [row.identity, row.digest]));
const short = (row) => row.identity.split("(")[0];

test("633 binds the notification state and legacy privacy correction", () => {
  assert.equal(ledger.at(-1), "20260920233000");
  assert.equal(
    acceptedCatalogQuery("", ledger),
    finalSchemaCatalog(after, ledger),
  );
  assert.equal(after.inventory, before.inventory);
  assert.deepEqual(
    after.objects.filter((row) => !old.has(row.identity)).map(short),
    [
      "function:plugin_data.csf_redact_legacy_sheet_reasons",
      "function:plugin_data.csf_transition_notice_fingerprint",
    ],
  );
  assert.deepEqual(
    after.objects
      .filter(
        (row) => old.has(row.identity) && old.get(row.identity) !== row.digest,
      )
      .map(short),
    [
      "function:plugin_data.csf_authorize_publication_notification",
      "function:plugin_data.csf_publication_email_recipient_allowed",
      "function:plugin_data.csf_record_personal_notification",
      "function:plugin_data.csf_release_sheet_application_decisions",
      "function:plugin_data.csf_transition_notice_recipient_allowed",
    ],
  );
  assert.ok(
    before.objects.every((row) =>
      after.objects.some((next) => next.identity === row.identity),
    ),
  );
});

test("the byte-pinned correction invokes only the reviewed privacy cleanup", () => {
  const name = "20260920233000_csf_notice_state_and_legacy_review_privacy";
  const sql = read(`../../supabase/migrations/${name}.sql`);
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.match(
    sql,
    /SELECT plugin_data\.csf_redact_legacy_sheet_reasons\(\);\s*COMMIT;/u,
  );
  assert.match(sql, /AND a\.decision_reason=s\.released_reason/u);
  assert.match(sql, /AND m\.status_reason=l\.released_reason/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION plugin_data\.csf_redact_legacy_sheet_reasons\(\) FROM PUBLIC,anon,authenticated,service_role/u,
  );
  assert.doesNotMatch(
    sql,
    /(?:UPDATE|DELETE FROM) plugin_data\.csf_application_decision_sync_(?:rows|runs)/u,
  );
});
