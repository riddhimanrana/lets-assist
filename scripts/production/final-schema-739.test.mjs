import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import {
  maintenanceTarget,
  selectMaintenanceLedger,
} from "./maintenance-preflight.mjs";

const root = new URL("../../", import.meta.url).pathname;
const targetVersions = expectedVersions(root);
const versions = targetVersions.slice(0, 739);
const current = JSON.parse(
  readFileSync(new URL("./final-schema-739.json", import.meta.url), "utf8"),
);
const previous = JSON.parse(
  readFileSync(new URL("./final-schema-732.json", import.meta.url), "utf8"),
);

test("739 accepts only the reviewed migration ledger and preserved release guards", () => {
  assert.equal(versions.length, 739);
  assert.equal(versions.at(-1), "20261016063427");
  assert.equal(current.ledger, ledgerDigest(versions));
  assert.deepEqual(maintenanceTarget(root), targetVersions);
  const query = acceptedCatalogQuery("untrusted predecessor", versions);
  for (const guard of [
    "FULL JOIN expected",
    "process-project-statuses",
    "project_asset_object_delete_guard",
    "automaticUpdate",
    "csf_target_schema_verified",
  ])
    assert.ok(query.includes(guard), guard);
  assert.ok(!query.includes("untrusted predecessor"));
  assert.throws(() =>
    selectMaintenanceLedger(versions, versions.slice(0, -1), "target"),
  );
  assert.throws(() =>
    acceptedCatalogQuery("", [...versions, "20990101000000"]),
  );
});

test("739 inventory contains exactly the reviewed 733–739 schema changes", () => {
  const before = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  const after = new Map(
    current.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(current.inventory, previous.inventory);
  assert.equal(after.size, 1493);
  assert.deepEqual(
    [...after.keys()].filter((identity) => !before.has(identity)),
    [
      "function:private.enforce_certificate_event_timezone()",
      "function:private.project_attendance_slot_window(p_project_id uuid, p_schedule_id text)",
    ],
  );
  assert.deepEqual(
    [...before.keys()].filter((identity) => !after.has(identity)),
    [],
  );
  assert.deepEqual(
    [...after.keys()].filter(
      (identity) =>
        before.has(identity) && before.get(identity) !== after.get(identity),
    ),
    [
      "function:plugin_data.csf_assert_activity_earning_award(p_organization_id uuid, p_profile_id uuid, p_opportunity_id uuid, p_submission_id uuid, p_points numeric, p_rules_snapshot jsonb, p_selection jsonb)",
      "function:plugin_data.csf_begin_point_submission_authority_base_20260810(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid)",
      "function:public.process_automatic_check_ins()",
      "function:public.process_automatic_check_outs()",
      "relation:plugin_data.csf_point_submissions",
      "relation:public.certificate_verification_read_model",
      "relation:public.certificates",
      "relation:public.user_certificate_read_model",
    ],
  );
});
