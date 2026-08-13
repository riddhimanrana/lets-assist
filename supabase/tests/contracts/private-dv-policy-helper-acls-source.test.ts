import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const definitionMigrationName =
  "20260621193526_harden_dvsd_seasonal_workflow.sql";
const aclMigrationName =
  "20260813091801_harden_dv_private_policy_helper_acls.sql";

const definitionMigration = readFileSync(
  join(repositoryRoot, "supabase/migrations", definitionMigrationName),
  "utf8",
);
const aclMigration = readFileSync(
  join(repositoryRoot, "supabase/migrations", aclMigrationName),
  "utf8",
);
const pgTap = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/private_dv_policy_helper_acls.test.sql",
  ),
  "utf8",
);

const helperNames = ["is_dv_student", "can_access_dv_household"] as const;
const searchableExtensions = new Set([".js", ".mjs", ".sql", ".ts", ".tsx"]);

function policiesCalling(helperName: (typeof helperNames)[number]) {
  return [
    ...definitionMigration.matchAll(/CREATE POLICY\s+([a-z0-9_]+)[\s\S]*?;/giu),
  ]
    .filter((match) => match[0].includes(`private.${helperName}(`))
    .map((match) => ({
      body: match[0],
      name: match[1],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function nonPolicyCallers() {
  const ignored = new Set([
    `supabase/migrations/${definitionMigrationName}`,
    `supabase/migrations/${aclMigrationName}`,
    "supabase/tests/contracts/private-dv-policy-helper-acls-source.test.ts",
    "supabase/tests/database/private_dv_policy_helper_acls.test.sql",
  ]);

  return ["app", "lib", "services", "supabase"]
    .flatMap((root) =>
      readdirSync(join(repositoryRoot, root), {
        encoding: "utf8",
        recursive: true,
        withFileTypes: false,
      }).map((name) => join(root, name)),
    )
    .filter(
      (name) =>
        searchableExtensions.has(extname(name)) &&
        !ignored.has(name) &&
        helperNames.some((helperName) =>
          readFileSync(join(repositoryRoot, name), "utf8").includes(helperName),
        ),
    )
    .sort();
}

describe("private DV policy helper ACL source contract", () => {
  test("keeps both stable fixed-path definer signatures without replacing them", () => {
    for (const helperName of helperNames) {
      const definition = new RegExp(
        `CREATE OR REPLACE FUNCTION private\\.${helperName}\\([\\s\\S]*?\\$\\$;`,
        "u",
      ).exec(definitionMigration)?.[0];

      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = ''");
      expect(aclMigration).not.toContain(
        `CREATE OR REPLACE FUNCTION private.${helperName}`,
      );
    }
  });

  test("pins the exact authenticated RLS policy callers", () => {
    const studentPolicies = policiesCalling("is_dv_student");
    const householdPolicies = policiesCalling("can_access_dv_household");

    expect(studentPolicies.map(({ name }) => name)).toEqual([
      "dv_household_students_self_insert",
      "dv_memberships_insert",
      "dv_memberships_select",
      "dv_memberships_update",
      "dv_registration_entries_delete",
      "dv_registration_entries_insert",
      "dv_registration_entries_select",
      "dv_registration_entries_update",
      "dv_registrations_insert",
      "dv_registrations_select",
      "dv_registrations_update",
      "dv_requirements_insert",
      "dv_requirements_select",
    ]);
    expect(householdPolicies.map(({ name }) => name)).toEqual([
      "dv_guardians_select",
      "dv_household_guardians_member_insert",
      "dv_household_guardians_select",
      "dv_household_students_select",
      "dv_households_select",
      "dv_service_accounts_select",
      "dv_service_ledger_select",
    ]);

    for (const { body } of [...studentPolicies, ...householdPolicies]) {
      expect(body).toMatch(/\bTO authenticated\b/u);
    }
  });

  test("proves no later migration removed the policy callers", () => {
    const laterMigrations = readdirSync(
      join(repositoryRoot, "supabase/migrations"),
      { encoding: "utf8" },
    )
      .filter((name) => name > definitionMigrationName && name.endsWith(".sql"))
      .map((name) =>
        readFileSync(join(repositoryRoot, "supabase/migrations", name), "utf8"),
      )
      .join("\n");

    for (const { name } of [
      ...policiesCalling("is_dv_student"),
      ...policiesCalling("can_access_dv_household"),
    ]) {
      expect(laterMigrations).not.toMatch(
        new RegExp(`DROP POLICY(?: IF EXISTS)? ${name}\\b`, "u"),
      );
    }
  });

  test("finds no direct runtime caller requiring another execution role", () => {
    expect(nonPolicyCallers()).toEqual([]);
  });

  test("normalizes both ACLs to authenticated plus owner", () => {
    for (const helperName of helperNames) {
      expect(aclMigration).toContain(
        `REVOKE ALL ON FUNCTION private.${helperName}(uuid)`,
      );
      expect(aclMigration).toContain(
        "FROM PUBLIC, anon, authenticated, service_role;",
      );
      expect(aclMigration).toContain(
        `GRANT EXECUTE ON FUNCTION private.${helperName}(uuid)`,
      );
    }

    expect(aclMigration.match(/TO authenticated, postgres;/gu)).toHaveLength(2);
    expect(aclMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION private\.(?:is_dv_student|can_access_dv_household)\(uuid\)\s+TO (?:PUBLIC|anon|service_role)/u,
    );
  });

  test("ships an exact runtime ACL and definition pgTAP plan", () => {
    const declared = Number(/extensions\.plan\((\d+)\)/u.exec(pgTap)?.[1]);
    const actual = [
      ...pgTap.matchAll(/SELECT\s+extensions\.(?!plan\b|finish\b)\w+\s*\(/giu),
    ].length;

    expect({ actual, declared }).toEqual({ actual: 20, declared: 20 });
  });
});
