import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const migration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260902040000_csf_sheet_source_mapping_version_serialization.sql",
  ),
  "utf8",
);
const pgTap = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_sheet_source_mapping_version_serialization.test.sql",
  ),
  "utf8",
);

describe("CSF source mapping version serialization", () => {
  test("keeps the existing registry seam and assigns versions under the row update", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version()",
    );
    expect(migration).toContain("BEFORE UPDATE OF");
    expect(migration).toContain("ON plugin_data.csf_sheet_sources");
    expect(migration).not.toContain(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_register_sheet_source(",
    );
    expect(pgTap).toContain(
      "plugin_data.csf_register_sheet_source(uuid,uuid,uuid,text,jsonb)",
    );
  });

  test("binds every commit-shaping source field into the material comparison", () => {
    for (const member of [
      "'cohortId', OLD.cohort_id",
      "'sourceType', OLD.source_type",
      "'targetStrategy', OLD.target_strategy",
      "'duplicatePolicy', OLD.duplicate_policy",
      "'columnMappings', OLD.column_mappings",
      "'tabMappings', OLD.tab_mappings",
      "'sourceVariant', v_old_settings -> 'sourceVariant'",
      "'headerSignature', v_old_settings -> 'headerSignature'",
      "'meetingId', v_old_settings -> 'meetingId'",
      "'termId', v_old_settings -> 'termId'",
      "'partnerClubId', v_old_settings -> 'partnerClubId'",
    ]) {
      expect(migration).toContain(member);
    }
  });

  test("requires optimistic concurrency and preserves exact replay", () => {
    const changed = migration.indexOf("IF v_mapping_changed THEN");
    const expectedNext = migration.indexOf(
      "v_requested_version IS DISTINCT FROM v_old_version + 1",
    );
    const staleRefusal = migration.indexOf(
      "This import source mapping changed after it was loaded. Reload it and try again.",
      expectedNext,
    );
    const exactReplay = migration.indexOf(
      "v_requested_version = v_old_version",
      staleRefusal,
    );

    expect(changed).toBeGreaterThan(-1);
    expect(expectedNext).toBeGreaterThan(changed);
    expect(staleRefusal).toBeGreaterThan(expectedNext);
    expect(exactReplay).toBeGreaterThan(staleRefusal);
    expect(migration).toContain(
      "ELSIF v_requested_version > v_old_version + 1 THEN",
    );
    expect(pgTap).toContain(
      "'a lower stale version is refused even when the material mapping matches'",
    );
    expect(pgTap).toContain("both stale writers wait on the same source row");
    expect(pgTap).toContain(
      "one stale writer commits and the other receives the closed stale-mapping refusal",
    );
    expect(pgTap).toContain(
      "a fresh request for the losing mapping can advance from version two to three",
    );
  });

  test("stores only bounded header digests and gives different snapshots different versions", () => {
    expect(migration).toContain('"headerSignature": "string"');
    expect(migration).toContain("'^[0-9a-f]{64}$'");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_source_settings_schema()",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_sheet_source_settings(jsonb)",
    );
    expect(pgTap).toContain(
      "a second header snapshot cannot reuse the first snapshot version",
    );
    expect(pgTap).toContain(
      "the fresh header snapshot receives its own mapping version",
    );
  });

  test("validates mapping versions on creates before the update trigger exists", () => {
    expect(migration).toContain(
      "v_mapping_version_text !~ '^[1-9][0-9]{0,9}$'",
    );
    expect(migration).toContain(
      "v_mapping_version_text::bigint > c_mapping_version_max",
    );
    expect(pgTap).toContain(
      "a create cannot bypass the positive-integer mapping version contract",
    );
    expect(pgTap).toContain(
      "a create cannot store a mapping version outside the int4 preview domain",
    );
    expect(pgTap).toContain(
      "a legitimate create may start at adapter-selected version two",
    );
  });

  test("invalidates unsettled previews created before the serialization boundary", () => {
    const trigger = migration.indexOf(
      "CREATE TRIGGER csf_sheet_sources_mapping_version_before_update",
    );
    const invalidation = migration.indexOf("WITH affected_sources AS (");

    expect(invalidation).toBeGreaterThan(trigger);
    expect(migration).toContain(
      "preview.status IN ('pending', 'running', 'needs_resolution', 'partially_completed')",
    );
    expect(migration).toContain(
      "'pending', 'ambiguous', 'duplicate', 'conflict', 'error', 'resolved'",
    );
    expect(migration).toContain("queue.status IN ('queued', 'running')");
    expect(pgTap).toContain(
      "the 0202 fence rejects a preview prepared before the mapping change",
    );
  });

  test("keeps the trigger function owner-only", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version()",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version()",
    );
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role;",
    );
  });
});
