import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { reviewedDevelopmentVersions } from "./reconciliation-ledgers.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { projectStatusCronCatalog } from "./project-status-cron-catalog.mjs";
import { publishedEmbedded721Catalog } from "./published-embedded-721-catalog.mjs";
import { pausedSpeechDebateCatalog } from "./paused-speech-debate-catalog.mjs";
import { publicImageStorageCatalog } from "./public-image-storage-catalog.mjs";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = reviewedDevelopmentVersions(expectedVersions(root)).slice(
  0,
  725,
);
const read = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const before = read("./final-schema-724.json");
const after = read("./final-schema-725.json");

test("the v4 points migration follows all 724 reviewed migrations with unchanged SQL bytes", () => {
  assert.equal(versions.length, 725);
  assert.equal(versions.at(-1), "20261013071100");
  assert.throws(() => maintenanceTarget(root), /explicit release review/u);
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20261013071100_csf_repeatable_pending_activity_claims.sql",
      import.meta.url,
    ),
  );
  assert.equal(
    createHash("sha256").update(sql).digest("hex"),
    "694673006e4a8b1d34e7d57469a7c96b41eb50d789c75d613c8c45a876380a00",
  );
  assert.equal(
    acceptedCatalogQuery("untrusted predecessor", versions),
    projectStatusCronCatalog(
      publishedEmbedded721Catalog(
        pausedSpeechDebateCatalog(
          publicImageStorageCatalog(
            accountDeletionStorageCatalog(
              csfSubmissionDeletionCatalog(finalSchemaCatalog(after, versions)),
            ),
          ),
        ),
      ),
    ),
  );
});

test("the v4 catalog changes only the points functions and claim relation", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => previous.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_assert_activity_earning_award(p_organization_id uuid, p_profile_id uuid, p_opportunity_id uuid, p_submission_id uuid, p_points numeric, p_rules_snapshot jsonb, p_selection jsonb)",
      "function:plugin_data.csf_begin_point_submission_authority_base_20260810(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid)",
      "relation:plugin_data.csf_point_submissions",
    ],
  );
});
