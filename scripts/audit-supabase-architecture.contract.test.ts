import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const architectureAudit = readFileSync(
  new URL("./audit-supabase-architecture.sh", import.meta.url),
  "utf8",
);
const relationMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260812035110_public_client_relation_acl_catalog.sql",
    import.meta.url,
  ),
  "utf8",
);
const storageMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260812033551_client_acl_and_storage_posture_catalogs.sql",
    import.meta.url,
  ),
  "utf8",
);
const relationPgtap = readFileSync(
  new URL(
    "../supabase/tests/database/client_relation_grant_catalog.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const storagePgtap = readFileSync(
  new URL(
    "../supabase/tests/database/storage_bucket_posture_catalog.test.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Supabase architecture audit source contract", () => {
  test("reconciles relation and independent column ACL layers", () => {
    expect(relationMigration).toContain("aclexplode(attribute.attacl)");
    expect(relationMigration).toContain("REVOKE %s (%I)");
    expect(relationMigration).toContain("has_table_privilege(");
    expect(relationMigration).toContain("has_column_privilege(");
    expect(relationMigration).not.toContain(
      "information_schema.column_privileges",
    );

    expect(architectureAudit).toContain("aclexplode(attribute.attacl)");
    expect(architectureAudit).toContain("direct_unexpected");
    expect(architectureAudit).toContain("effective_unexpected");
    expect(architectureAudit).not.toContain(
      "information_schema.column_privileges",
    );

    for (const requiredProbe of [
      "PUBLIC column grant residue is detected",
      "anonymous independent column residue is detected",
      "authenticated column residue is detected even beside a whole-table grant",
    ]) {
      expect(relationPgtap).toContain(requiredProbe);
    }
  });

  test("uses an exact fail-closed storage policy contract", () => {
    for (const requiredContractPart of [
      "storage_object_policy_contract",
      "storage_object_policy_catalog()",
      "storage_object_policy_contract_violations()",
      "policy.polpermissive",
      "policy.polroles",
      "pg_get_expr(policy.polqual",
      "pg_get_expr(policy.polwithcheck",
      "pg_has_role(client_roles.oid, policy_role.role_oid, 'USAGE')",
      "storage objects policy reconciliation found",
    ]) {
      expect(storageMigration).toContain(requiredContractPart);
    }

    expect(architectureAudit).toContain(
      "app_private.storage_object_policy_contract_violations()",
    );
    expect(architectureAudit).toContain("not relation.relrowsecurity");
    expect(architectureAudit).not.toContain(
      "like ('%bucket_id = ''' || c.bucket_id",
    );
    for (const removedHeuristic of [
      "public_storage_listing_policies",
      "server_only_storage_client_policies",
      "private_client_storage_policy_gaps",
    ]) {
      expect(architectureAudit).not.toContain(removedHeuristic);
    }
  });

  test("keeps adversarial policy shapes in the replay gate", () => {
    for (const requiredProbe of [
      "broad authenticated USING true policy is rejected",
      "policy omitting a bucket predicate is rejected",
      "PUBLIC policy is client-reachable",
      "policy reachable through inherited role membership is rejected",
      "policy command drift is rejected",
      "policy role drift is rejected",
      "USING expression drift is rejected",
      "WITH CHECK expression drift is rejected",
      "permissive versus restrictive policy shape drift is rejected",
      "server-only buckets have zero reviewed browser-direct",
      "private-client policies retain exact authenticated bucket-scoped access",
    ]) {
      expect(storagePgtap).toContain(requiredProbe);
    }
  });
});
