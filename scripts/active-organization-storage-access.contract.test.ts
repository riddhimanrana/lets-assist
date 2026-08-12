import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const hardeningMigration = read(
  "supabase/migrations/20260812063639_harden_active_organization_storage_access.sql",
);
const storageCatalogMigration = read(
  "supabase/migrations/20260812033551_client_acl_and_storage_posture_catalogs.sql",
);
const relationCatalogMigration = read(
  "supabase/migrations/20260812035110_public_client_relation_acl_catalog.sql",
);
const paperScanMigration = read(
  "supabase/migrations/20260811100000_project_paper_signup_scans.sql",
);
const activeMembershipPgtap = read(
  "supabase/tests/database/active_organization_storage_access.test.sql",
);
const organizationProfileActions = read(
  "app/organization/[id]/settings/server/profile.ts",
);
const accountSecurityActions = read("app/account/security/actions.ts");
const dataExportWorker = read("lib/supabase/data-export-jobs.ts");

const storagePolicy = (sql: string, policyName: string) => {
  const escapedName = policyName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `CREATE\\s+POLICY\\s+"${escapedName}"[\\s\\S]*?;`,
    "iu",
  ).exec(sql);
  if (!match) throw new Error(`Missing storage policy: ${policyName}`);
  return match[0];
};

const sqlFunction = (sql: string, qualifiedName: string) => {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+${escapedName}[\\s\\S]*?\\$\\$;`,
    "iu",
  ).exec(sql);
  if (!match) throw new Error(`Missing SQL function: ${qualifiedName}`);
  return match[0];
};

const ignoredSourceDirectories = new Set([
  ".artifacts",
  ".git",
  ".next",
  "coverage",
  "docs",
  "node_modules",
  "public",
  "schemas",
  "seeds",
  "tests",
]);

const sourceFiles = (directory: string): string[] =>
  readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name.startsWith(".") ||
          ignoredSourceDirectories.has(entry.name)
          ? []
          : sourceFiles(path);
      }
      if (!/\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
      return [path];
    },
  );

const callersOf = (relation: string) =>
  sourceFiles(".")
    .filter((path) => read(path).includes(`.from("${relation}")`))
    .map((path) => relative(root, join(root, path)))
    .sort();

const catalogGrantRows = (catalogFunction: string) =>
  catalogFunction
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("('"));

describe("active organization storage authorization source contract", () => {
  test("the canonical organization mutation requires an active admin membership", () => {
    const authorization = organizationProfileActions.match(
      /const \{ data: membership \}[\s\S]*?if \(!membership\)/u,
    )?.[0];

    expect(authorization).toContain('.select("role,status")');
    expect(authorization).toContain('.eq("role", "admin")');
    expect(authorization).toContain('.eq("status", "active")');
  });

  test("every direct organization-member Storage predicate requires active status", () => {
    for (const policyName of [
      "Authenticated users can upload organization logos",
      "Authenticated users can update organization logos",
      "Authenticated users can delete organization logos",
      "Org staff can view their org plugin form files",
    ]) {
      const policy = storagePolicy(hardeningMigration, policyName);
      expect(policy).toContain("public.organization_members");
      expect(policy).toMatch(/organization_member\.status\s*=\s*'active'/u);
    }
  });

  test("project helpers preserve creators but require active organization staff", () => {
    for (const qualifiedName of [
      "app_private.is_project_organizer",
      "app_private.can_manage_project",
    ]) {
      const definition = sqlFunction(hardeningMigration, qualifiedName);
      expect(definition).toContain("SET search_path = ''");
      expect(definition).toMatch(/projects\.creator_id\s*=\s*p_user/u);
      expect(definition).toMatch(/members\.status\s*=\s*'active'/u);
      expect(hardeningMigration).toContain(
        `REVOKE ALL ON FUNCTION ${qualifiedName}(uuid, uuid)`,
      );
      expect(hardeningMigration).toContain(
        `GRANT EXECUTE ON FUNCTION ${qualifiedName}(uuid, uuid)`,
      );
    }
  });

  test("all project asset and paper-scan policies delegate to hardened helpers", () => {
    const organizerPolicies = [
      "Project managers can upload project images",
      "Project managers can update project images",
      "Project managers can delete project images",
      "Project managers can upload project documents",
      "Project managers can update project documents",
      "Project managers can delete project documents",
      "Project managers can upload project waiver files",
      "Project managers can delete project waiver files",
    ];
    const paperPolicies = [
      "Project managers can upload paper signup scans",
      "Project managers can read paper signup scans",
      "Project managers can delete paper signup scans",
    ];

    for (const policyName of organizerPolicies) {
      expect(storagePolicy(storageCatalogMigration, policyName)).toContain(
        "public.is_project_organizer",
      );
    }
    for (const policyName of paperPolicies) {
      expect(storagePolicy(storageCatalogMigration, policyName)).toContain(
        "app_private.can_manage_project",
      );
    }
    for (const policyName of [
      "paper_scan_batches_select_organizer",
      "paper_scan_images_select_organizer",
      "paper_scan_rows_select_organizer",
      "paper_roster_entries_select_organizer",
    ]) {
      const escapedName = policyName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const policy = new RegExp(
        `CREATE\\s+POLICY\\s+${escapedName}[\\s\\S]*?;`,
        "iu",
      ).exec(paperScanMigration)?.[0];
      expect(policy).toContain("app_private.can_manage_project");
    }
  });

  test("the exact Storage catalog is refreshed from fixed-context live truth", () => {
    for (const policyName of [
      "Authenticated users can upload organization logos",
      "Authenticated users can update organization logos",
      "Authenticated users can delete organization logos",
      "Org staff can view their org plugin form files",
    ]) {
      expect(hardeningMigration).toContain(`('${policyName}'::text)`);
    }
    expect(hardeningMigration).toContain(
      "app_private.storage_object_policy_live_catalog()",
    );
    expect(hardeningMigration).toContain(
      "app_private.storage_object_policy_contract_violations()",
    );
  });

  test("pgTAP covers active, inactive, cross-org, creator, and uploader paths", () => {
    const declaredPlan = Number(
      /extensions\.plan\((\d+)\)/u.exec(activeMembershipPgtap)?.[1],
    );
    const actualAssertions = [
      ...activeMembershipPgtap.matchAll(
        /SELECT\s+extensions\.(?!plan\b|finish\b)\w+\s*\(/giu,
      ),
    ].length;

    expect({ actualAssertions, declaredPlan }).toEqual({
      actualAssertions: 31,
      declaredPlan: 31,
    });
    for (const requiredEvidence of [
      "active organization staff retain",
      "inactive organization staff",
      "cross-organization staff",
      "project creator retains",
      "plugin-form uploader retains",
      "service_role retains",
    ]) {
      expect(activeMembershipPgtap).toContain(requiredEvidence);
    }
  });
});

describe("data export relation caller and ACL source contract", () => {
  test("audit logs have only service-client callers", () => {
    const accountRequestAudit = accountSecurityActions.slice(
      accountSecurityActions.indexOf("export async function emailDataExport"),
      accountSecurityActions.indexOf("export async function getDataExportJobs"),
    );
    const workerAudit = dataExportWorker.slice(
      dataExportWorker.indexOf("async function writeAuditEvent"),
      dataExportWorker.indexOf("async function completeJob"),
    );

    expect(callersOf("account_data_export_audit_logs")).toEqual([
      "app/account/security/actions.ts",
      "lib/supabase/data-export-jobs.ts",
    ]);
    expect(accountRequestAudit).toMatch(
      /const adminClient = getAdminClient\(\);[\s\S]*?adminClient\.from\("account_data_export_audit_logs"\)\.insert\(/u,
    );
    expect(workerAudit).toMatch(
      /const supabase = getAdminClient\(\);[\s\S]*?supabase\s*\.from\("account_data_export_audit_logs"\)\s*\.insert\(/u,
    );
  });

  test("browser export jobs retain only the used insert and select capabilities", () => {
    const accountEnqueue = accountSecurityActions.slice(
      accountSecurityActions.indexOf("export async function emailDataExport"),
      accountSecurityActions.indexOf("export async function getDataExportJobs"),
    );
    const accountRead = accountSecurityActions.slice(
      accountSecurityActions.indexOf("export async function getDataExportJobs"),
    );

    expect(callersOf("account_data_export_jobs")).toEqual([
      "app/account/security/actions.ts",
      "lib/supabase/data-export-jobs.ts",
    ]);
    expect(accountEnqueue).toMatch(
      /supabase\s*\.from\("account_data_export_jobs"\)\s*\.insert\(/u,
    );
    expect(accountRead).toMatch(
      /supabase\s*\.from\("account_data_export_jobs"\)\s*\.select\(/u,
    );
    expect(dataExportWorker).toContain("getAdminClient()");
    expect(dataExportWorker).not.toContain('from "./server"');
    expect(dataExportWorker).not.toContain("createClient()");
    expect(dataExportWorker).toMatch(
      /supabase\s*\.from\("account_data_export_jobs"\)\s*\.update\(/u,
    );
    expect(`${accountSecurityActions}\n${dataExportWorker}`).not.toMatch(
      /(?:adminClient|supabase)\s*\.from\("account_data_export_jobs"\)\s*\.delete\(/u,
    );
  });

  test("the reviewed relation catalog removes only server-only export grants", () => {
    const catalog = sqlFunction(
      hardeningMigration,
      "app_private.client_relation_grant_catalog",
    );
    const previousCatalog = sqlFunction(
      relationCatalogMigration,
      "app_private.client_relation_grant_catalog",
    );
    const expectedCatalogRows = catalogGrantRows(previousCatalog).filter(
      (row) =>
        !row.startsWith("('account_data_export_audit_logs'::text") &&
        !row.startsWith(
          "('account_data_export_jobs'::text, 'authenticated'::text, 'DELETE'::text",
        ) &&
        !row.startsWith(
          "('account_data_export_jobs'::text, 'authenticated'::text, 'UPDATE'::text",
        ),
    );

    expect(catalogGrantRows(catalog)).toEqual(expectedCatalogRows);
    expect(catalog).not.toContain("('account_data_export_audit_logs'::text");
    expect(catalog).toContain(
      "('account_data_export_jobs'::text, 'authenticated'::text, 'INSERT'::text",
    );
    expect(catalog).toContain(
      "('account_data_export_jobs'::text, 'authenticated'::text, 'SELECT'::text",
    );
    expect(catalog).not.toContain(
      "('account_data_export_jobs'::text, 'authenticated'::text, 'UPDATE'::text",
    );
    expect(catalog).not.toContain(
      "('account_data_export_jobs'::text, 'authenticated'::text, 'DELETE'::text",
    );
    expect(catalog).toContain("SET search_path = ''");
  });
});
