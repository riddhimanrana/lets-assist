import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const migrationsRoot = join(repositoryRoot, "supabase/migrations");
const preflight = readFileSync(
  join(repositoryRoot, "scripts/production-cutover-preflight.sql"),
  "utf8",
);
const architectureAudit = readFileSync(
  join(repositoryRoot, "scripts/audit-supabase-architecture.sh"),
  "utf8",
);
const TARGET_HEAD = "20260903050000";

function readMigration(version: string) {
  const name = readdirSync(migrationsRoot).find((entry) =>
    entry.startsWith(`${version}_`),
  );
  if (!name) throw new Error(`Migration ${version} is missing`);
  return readFileSync(join(migrationsRoot, name), "utf8");
}

test("carries the repository security gates into the target preflight", () => {
  const functionAclBlock = architectureAudit.slice(
    architectureAudit.indexOf("public_client_function_acl_drift="),
    architectureAudit.indexOf(
      "summary=",
      architectureAudit.indexOf("public_client_function_acl_drift="),
    ),
  );
  const currentClientFunctions = [
    ...functionAclBlock.matchAll(
      /\('([^']+\([^']*\))', '(anon|authenticated)'\)/gu,
    ),
  ].map((match) => [match[1], match[2]]);

  // The 444 preflight predates the permanent request hook introduced at 688.
  // Exclude only that reviewed invoker, preserving the historical definer ACL.
  const requestFenceVersion = "20260929051600";
  const requestFenceSignature =
    "public.enforce_application_request_write_fence()";
  expect(requestFenceVersion > TARGET_HEAD).toBe(true);
  const requestFence = readMigration(requestFenceVersion);
  expect(requestFence).toContain(`CREATE FUNCTION ${requestFenceSignature}`);
  expect(requestFence).toMatch(/VOLATILE\s+SECURITY INVOKER/u);
  expect(requestFence).not.toMatch(/SECURITY DEFINER/u);
  expect(requestFence).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.enforce_application_request_write_fence\(\)\s+TO anon, authenticated, service_role, postgres;/u,
  );
  expect(
    currentClientFunctions.filter(
      ([signature]) => signature === requestFenceSignature,
    ),
  ).toEqual([
    [requestFenceSignature, "anon"],
    [requestFenceSignature, "authenticated"],
  ]);
  const expectedClientFunctions = currentClientFunctions.filter(
    ([signature]) => signature !== requestFenceSignature,
  );

  const preflightFunctionAclBlock = preflight.slice(
    preflight.indexOf("T5  Public read-model and function ACL posture"),
    preflight.indexOf("T6  Exact target relation ACL"),
  );
  const preflightClientFunctions = [
    ...preflightFunctionAclBlock.matchAll(
      /\('([^']+\([^']*\))',\s*'(anon|authenticated)'\)/gu,
    ),
  ].map((match) => [match[1], match[2]]);

  expect(expectedClientFunctions.length).toBeGreaterThan(0);
  expect(preflightClientFunctions).toEqual(expectedClientFunctions);
  expect(preflight).toContain("S1  plugin_data RLS and browser isolation");
  expect(preflight).toContain("NOT relation.relrowsecurity");
  expect(preflight).toContain(
    "has_schema_privilege(client.role_name, namespace.oid, 'USAGE')",
  );
  expect(preflight).toContain(
    "has_function_privilege(client.role_name, function_record.oid, 'EXECUTE')",
  );
  expect(preflightFunctionAclBlock).toContain("security_invoker=true");
  expect(preflightFunctionAclBlock).toContain("function_record.prosecdef");

  const privateDvAclMigration = readMigration("20260813091801");
  for (const helperName of ["is_dv_student", "can_access_dv_household"]) {
    expect(privateDvAclMigration).toContain(
      `REVOKE ALL ON FUNCTION private.${helperName}(uuid)`,
    );
    expect(privateDvAclMigration).toContain(
      `GRANT EXECUTE ON FUNCTION private.${helperName}(uuid)`,
    );
  }
  expect(privateDvAclMigration).toContain(
    "FROM PUBLIC, anon, authenticated, service_role;",
  );
  expect(
    privateDvAclMigration.match(/TO authenticated, postgres;/gu),
  ).toHaveLength(2);

  const issuerGuard = readMigration("20260812193400");
  expect(issuerGuard).toContain(
    "CREATE OR REPLACE FUNCTION private.protect_staff_join_token_issuer()",
  );
  expect(issuerGuard).toMatch(
    /NEW\.staff_join_token_issued_by\s+IS DISTINCT FROM OLD\.staff_join_token_issued_by/u,
  );
  expect(issuerGuard).toContain(
    "REVOKE ALL ON FUNCTION private.protect_staff_join_token_issuer()",
  );
  expect(issuerGuard).toContain("TO postgres;");
});
