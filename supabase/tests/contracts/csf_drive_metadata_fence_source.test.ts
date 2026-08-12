import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

const migration = read(
  "supabase/migrations/20260812132725_csf_drive_metadata_compare_and_set_fence.sql",
);
const caller = read(
  "lib/plugins/private/plugins/dvhs-csf/server/actions/support-import-registration.ts",
);
const pgTap = read("supabase/tests/database/csf_drive_metadata_fence.test.sql");

const functionName = "plugin_data\\.csf_refresh_sheet_source_drive_metadata";
const legacyArguments = String.raw`\(\s*uuid,\s*uuid,\s*uuid,\s*jsonb\s*\)`;
const fencedArguments = String.raw`\(\s*uuid,\s*uuid,\s*uuid,\s*text,\s*text,\s*text,\s*jsonb\s*\)`;
const argumentNames = [
  "p_organization_id",
  "p_actor_user_id",
  "p_source_id",
  "p_expected_provider",
  "p_expected_file_id",
  "p_provider_file_id",
  "p_metadata",
];

describe("CSF Drive metadata compare-and-set source contract", () => {
  test("the migration and caller expose the same exact seven named arguments", () => {
    const definitionStart = migration.indexOf(
      "CREATE FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(",
    );
    const definitionEnd = migration.indexOf(
      ")\nRETURNS jsonb",
      definitionStart,
    );
    const definition = migration.slice(definitionStart, definitionEnd);

    expect(definitionStart).toBeGreaterThanOrEqual(0);
    expect(
      [...definition.matchAll(/^\s+(p_[a-z_]+)\s+/gmu)].map(
        (match) => match[1],
      ),
    ).toEqual(argumentNames);

    const callStart = caller.indexOf(
      '"csf_refresh_sheet_source_drive_metadata"',
    );
    const callEnd = caller.indexOf("\n    },", callStart);
    const call = caller.slice(callStart, callEnd);

    expect(callStart).toBeGreaterThanOrEqual(0);
    expect(
      [...call.matchAll(/^\s+(p_[a-z_]+):/gmu)].map((match) => match[1]),
    ).toEqual(argumentNames);
  });

  test("the forward migration replaces the obsolete overload with one service-only boundary", () => {
    expect(migration).toMatch(
      new RegExp(
        `v_legacy_signature constant text :=\\s*'${functionName}${legacyArguments}';`,
        "u",
      ),
    );
    expect(migration).toMatch(
      /IF pg_catalog\.to_regprocedure\(v_legacy_signature\) IS NOT NULL THEN[\s\S]*?EXECUTE pg_catalog\.format\(\s*'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',\s*v_legacy_signature\s*\);[\s\S]*?EXECUTE pg_catalog\.format\('DROP FUNCTION %s', v_legacy_signature\);[\s\S]*?END IF;/u,
    );
    expect(migration).toMatch(
      new RegExp(
        `REVOKE ALL ON FUNCTION ${functionName}${fencedArguments}\\s+FROM PUBLIC, anon, authenticated, service_role;`,
        "u",
      ),
    );
    expect(migration).toMatch(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION ${functionName}${fencedArguments}\\s+TO service_role;`,
        "u",
      ),
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
  });

  test("the multiline SQL validates caller fences before authorization", () => {
    expect(migration).toMatch(
      /IF p_expected_provider IS DISTINCT FROM 'google_sheets' THEN[\s\S]*?END IF;\s+IF p_expected_file_id IS NULL\s+OR pg_catalog\.btrim\(p_expected_file_id\) = ''\s+THEN[\s\S]*?END IF;[\s\S]*?PERFORM plugin_data\.csf_assert_import_actor_for_source\(/u,
    );
    expect(migration).toMatch(
      /IF p_provider_file_id IS NOT NULL\s+AND p_provider_file_id IS DISTINCT FROM p_expected_file_id\s+THEN/u,
    );
  });

  test("authorization fences the canonical staff lock and locked source mutation", () => {
    const functionStart = migration.indexOf(
      "CREATE FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(",
    );
    const functionEnd = migration.indexOf("$$;", functionStart);
    const body = migration.slice(functionStart, functionEnd);
    const authorization =
      "PERFORM plugin_data.csf_assert_import_actor_for_source(";
    const authorizationOffsets = [
      ...body.matchAll(
        /PERFORM plugin_data\.csf_assert_import_actor_for_source\(/gu,
      ),
    ].map((match) => match.index);
    const staffLockOffset = body.indexOf(
      "PERFORM pg_catalog.pg_advisory_xact_lock(",
    );
    const staffLockKeyOffset = body.indexOf(
      "plugin_data.csf_staff_access_lock_key(p_organization_id)",
      staffLockOffset,
    );
    const sourceRowLockOffset = body.indexOf("FOR UPDATE;");
    const metadataUpdateOffset = body.indexOf(
      "UPDATE plugin_data.csf_sheet_sources AS source",
    );

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);
    expect(authorizationOffsets).toHaveLength(3);
    expect(body.indexOf(authorization)).toBe(authorizationOffsets[0]);
    expect(authorizationOffsets[0]).toBeLessThan(staffLockOffset);
    expect(staffLockKeyOffset).toBeGreaterThan(staffLockOffset);
    expect(authorizationOffsets[1]).toBeGreaterThan(staffLockKeyOffset);
    expect(authorizationOffsets[1]).toBeLessThan(sourceRowLockOffset);
    expect(authorizationOffsets[2]).toBeGreaterThan(sourceRowLockOffset);
    expect(authorizationOffsets[2]).toBeLessThan(metadataUpdateOffset);
    expect(body).not.toContain("csf_identity_mutation_lock_key");
  });

  test("the hostile pgTAP plan matches its assertion count", () => {
    const planned = Number(pgTap.match(/extensions\.plan\((\d+)\)/u)?.[1]);
    const assertions = pgTap.match(
      /SELECT extensions\.(?:ok|is|isnt|lives_ok|throws_ok|results_eq)\(/gu,
    );

    expect(planned).toBe(assertions?.length ?? 0);
  });
});
