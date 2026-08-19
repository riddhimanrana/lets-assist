import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const architectureAudit = readFileSync(
  new URL("./audit-supabase-architecture.sh", import.meta.url),
  "utf8",
);
const relationMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260812100900_public_client_relation_acl_catalog.sql",
    import.meta.url,
  ),
  "utf8",
);
const storageMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260812100800_client_acl_and_storage_posture_catalogs.sql",
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

type StoragePolicy = {
  policyName: string;
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  roles: string[];
  isPermissive: boolean;
  usingExpression: string | null;
  withCheckExpression: string | null;
  bucketId: string;
};

type ReviewedStoragePolicy = StoragePolicy & {
  intendedOwner: string;
};

const normalizeSql = (sql: string) =>
  sql.trim().replace(/\s+/gu, " ").toLowerCase();

const canonicalizePolicyAliases = (sql: string | null) => {
  if (sql === null) return null;

  return normalizeSql(sql)
    .replace(
      /from public\.organization_members(?: as)? (?:organization_member|om)/gu,
      "from public.organization_members actor",
    )
    .replace(/\b(?:organization_member|om)\./gu, "actor.")
    .replace(
      /from public\.projects(?: as)? (?:projects|project|p)/gu,
      "from public.projects resource",
    )
    .replace(/\b(?:projects|project|p)\./gu, "resource.");
};

const extractPolicyClause = (statement: string, clause: RegExp) => {
  const match = clause.exec(statement);
  if (!match) return null;

  const openParenthesis = statement.indexOf("(", match.index);
  let depth = 0;
  let inSingleQuote = false;

  for (let index = openParenthesis; index < statement.length; index += 1) {
    const character = statement[index];
    const nextCharacter = statement[index + 1];

    if (character === "'" && inSingleQuote && nextCharacter === "'") {
      index += 1;
      continue;
    }
    if (character === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;

    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return canonicalizePolicyAliases(
          statement.slice(openParenthesis + 1, index),
        );
      }
    }
  }

  throw new Error(`Unbalanced policy clause: ${statement}`);
};

const parseStoragePolicy = (statement: string): StoragePolicy => {
  const name = /create\s+policy\s+"([^"]+)"/iu.exec(statement)?.[1];
  const command = /\bfor\s+(select|insert|update|delete)\b/iu.exec(
    statement,
  )?.[1];
  const roleSource =
    /\bto\s+([\s\S]*?)(?=\s+(?:using|with\s+check)\s*\()/iu.exec(
      statement,
    )?.[1];
  const usingExpression = extractPolicyClause(statement, /\busing\s*\(/iu);
  const withCheckExpression = extractPolicyClause(
    statement,
    /\bwith\s+check\s*\(/iu,
  );
  const bucketIds = new Set(
    [...statement.matchAll(/\bbucket_id\s*=\s*'([^']+)'/giu)].map(
      (match) => match[1],
    ),
  );

  if (!name || !command || bucketIds.size !== 1) {
    throw new Error(`Invalid storage policy statement: ${statement}`);
  }

  return {
    policyName: name,
    command: command.toUpperCase() as StoragePolicy["command"],
    roles: roleSource
      ? roleSource
          .split(",")
          .map((role) => role.trim().replaceAll('"', "").toLowerCase())
          .sort()
      : ["public"],
    isPermissive: !/\bas\s+restrictive\b/iu.test(statement),
    usingExpression,
    withCheckExpression,
    bucketId: [...bucketIds][0],
  };
};

const storagePolicyStatements = (sql: string) =>
  [
    ...sql.matchAll(
      /(?:drop\s+policy\s+(?:if\s+exists\s+)?"[^"]+"\s+on\s+storage\.objects\s*;|create\s+policy\s+"[^"]+"\s+on\s+storage\.objects[\s\S]*?;)/giu,
    ),
  ].map((match) => match[0]);

const storagePolicyCreates = (sql: string) =>
  storagePolicyStatements(sql)
    .filter((statement) => /^create\s+policy/iu.test(statement))
    .map(parseStoragePolicy);

const storagePolicyContractBuckets = (sql: string) => {
  const values =
    /with\s+reviewed_policy\s*\(policy_name,\s*bucket_id\)\s+as\s*\(\s*values([\s\S]*?)\)\s*insert\s+into\s+app_private\.storage_object_policy_contract/iu.exec(
      sql,
    )?.[1];

  if (!values) throw new Error("Missing reviewed storage policy catalog");

  return [...values.matchAll(/\('([^']+)'::text,\s*'([^']+)'::text\)/gu)]
    .map((match) => ({ policyName: match[1], bucketId: match[2] }))
    .sort(byPolicyName);
};

const reviewedPredicate = (sql: string) => canonicalizePolicyAliases(sql);

const avatarOwner = reviewedPredicate(`
  bucket_id = 'avatars'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '%'
`);
const organizationLogoManager = reviewedPredicate(`
  bucket_id = 'organization-logos'
  AND EXISTS (
    SELECT 1
    FROM public.organization_members AS organization_member
    WHERE organization_member.organization_id = split_part(name, '.', 1)::uuid
      AND organization_member.user_id = auth.uid()
      AND organization_member.role IN ('admin', 'staff')
  )
`);
const pluginUploadOwner = reviewedPredicate(`
  bucket_id = 'plugin_form_uploads'
  AND auth.uid() IS NOT NULL
  AND (string_to_array(name, '/'))[3] = auth.uid()::text
`);
const pluginOrganizationManager = reviewedPredicate(`
  bucket_id = 'plugin_form_uploads'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.organization_members AS organization_member
    WHERE organization_member.organization_id::text = (string_to_array(name, '/'))[1]
      AND organization_member.user_id = auth.uid()
      AND organization_member.role IN ('admin', 'staff')
  )
`);
const projectManager = (bucketId: string, pathPattern: string) =>
  reviewedPredicate(`
    bucket_id = '${bucketId}'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '${pathPattern}')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  `);
const waiverSourceManager = reviewedPredicate(`
  bucket_id = 'waiver-uploads'
  AND NOT private.waiver_source_storage_object_is_referenced(name)
  AND EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = substring(name from '^project_waivers/([0-9a-fA-F-]{36})/')::uuid
      AND public.is_project_organizer(project.id, (SELECT auth.uid()))
  )
`);
const paperScanManager = reviewedPredicate(`
  bucket_id = 'paper-signup-scans'
  AND EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = substring(name from '^paper_signups/([0-9a-fA-F-]{36})/')::uuid
      AND app_private.can_manage_project(project.id, (SELECT auth.uid()))
  )
`);

type ReviewedStoragePolicyRow = [
  policyName: string,
  command: StoragePolicy["command"],
  bucketId: string,
  usingExpression: string | null,
  withCheckExpression: string | null,
  intendedOwner: string,
];

const reviewedStoragePolicyRows: ReviewedStoragePolicyRow[] = [
  [
    "Authenticated users can upload own avatars",
    "INSERT",
    "avatars",
    null,
    avatarOwner,
    "authenticated user named by the object prefix",
  ],
  [
    "Authenticated users can update own avatars",
    "UPDATE",
    "avatars",
    avatarOwner,
    avatarOwner,
    "authenticated user named by the object prefix",
  ],
  [
    "Authenticated users can delete own avatars",
    "DELETE",
    "avatars",
    avatarOwner,
    null,
    "authenticated user named by the object prefix",
  ],
  [
    "Authenticated users can upload organization logos",
    "INSERT",
    "organization-logos",
    null,
    organizationLogoManager,
    "current organization admin or staff member",
  ],
  [
    "Authenticated users can update organization logos",
    "UPDATE",
    "organization-logos",
    organizationLogoManager,
    organizationLogoManager,
    "current organization admin or staff member",
  ],
  [
    "Authenticated users can delete organization logos",
    "DELETE",
    "organization-logos",
    organizationLogoManager,
    null,
    "current organization admin or staff member",
  ],
  [
    "Authenticated users can upload own plugin form files",
    "INSERT",
    "plugin_form_uploads",
    null,
    pluginUploadOwner,
    "authenticated uploader in path segment three",
  ],
  [
    "Authenticated users can view own plugin form files",
    "SELECT",
    "plugin_form_uploads",
    pluginUploadOwner,
    null,
    "authenticated uploader in path segment three",
  ],
  [
    "Org staff can view their org plugin form files",
    "SELECT",
    "plugin_form_uploads",
    pluginOrganizationManager,
    null,
    "current organization admin or staff member",
  ],
  [
    "Authenticated users can delete own plugin form files",
    "DELETE",
    "plugin_form_uploads",
    pluginUploadOwner,
    null,
    "authenticated uploader in path segment three",
  ],
  [
    "Project managers can upload project images",
    "INSERT",
    "project-images",
    null,
    projectManager("project-images", "^project_([0-9a-fA-F-]{36})_"),
    "current project organizer",
  ],
  [
    "Project managers can update project images",
    "UPDATE",
    "project-images",
    projectManager("project-images", "^project_([0-9a-fA-F-]{36})_"),
    projectManager("project-images", "^project_([0-9a-fA-F-]{36})_"),
    "current project organizer",
  ],
  [
    "Project managers can delete project images",
    "DELETE",
    "project-images",
    projectManager("project-images", "^project_([0-9a-fA-F-]{36})_"),
    null,
    "current project organizer",
  ],
  [
    "Project managers can upload project documents",
    "INSERT",
    "project-documents",
    null,
    projectManager("project-documents", "^project_([0-9a-fA-F-]{36})_"),
    "current project organizer",
  ],
  [
    "Project managers can update project documents",
    "UPDATE",
    "project-documents",
    projectManager("project-documents", "^project_([0-9a-fA-F-]{36})_"),
    projectManager("project-documents", "^project_([0-9a-fA-F-]{36})_"),
    "current project organizer",
  ],
  [
    "Project managers can delete project documents",
    "DELETE",
    "project-documents",
    projectManager("project-documents", "^project_([0-9a-fA-F-]{36})_"),
    null,
    "current project organizer",
  ],
  [
    "Project managers can upload project waiver files",
    "INSERT",
    "waiver-uploads",
    null,
    projectManager("waiver-uploads", "^project_waivers/([0-9a-fA-F-]{36})/"),
    "current project organizer",
  ],
  [
    "Project managers can delete project waiver files",
    "DELETE",
    "waiver-uploads",
    waiverSourceManager,
    null,
    "current project organizer when the source is unreferenced",
  ],
  [
    "Project managers can upload paper signup scans",
    "INSERT",
    "paper-signup-scans",
    null,
    paperScanManager,
    "current project manager",
  ],
  [
    "Project managers can read paper signup scans",
    "SELECT",
    "paper-signup-scans",
    paperScanManager,
    null,
    "current project manager",
  ],
  [
    "Project managers can delete paper signup scans",
    "DELETE",
    "paper-signup-scans",
    paperScanManager,
    null,
    "current project manager",
  ],
];

const reviewedStoragePolicies: ReviewedStoragePolicy[] =
  reviewedStoragePolicyRows.map(
    ([
      policyName,
      command,
      bucketId,
      usingExpression,
      withCheckExpression,
      intendedOwner,
    ]) => ({
      policyName,
      command,
      roles: ["authenticated"],
      isPermissive: true,
      usingExpression,
      withCheckExpression,
      bucketId,
      intendedOwner,
    }),
  );

const comparablePolicy = ({
  intendedOwner: _,
  ...policy
}: ReviewedStoragePolicy) => policy;

const byPolicyName = <T extends { policyName: string }>(left: T, right: T) =>
  left.policyName.localeCompare(right.policyName);

const replayHistoricalStoragePolicyLedger = () => {
  const migrationsDirectory = new URL(
    "../supabase/migrations/",
    import.meta.url,
  );
  const policies = new Map<string, StoragePolicy>();

  for (const migrationName of readdirSync(migrationsDirectory)
    .filter(
      (name) =>
        name.endsWith(".sql") &&
        name < "20260812100800_client_acl_and_storage_posture_catalogs.sql",
    )
    .sort()) {
    const migration = readFileSync(
      new URL(migrationName, migrationsDirectory),
      "utf8",
    );
    for (const statement of storagePolicyStatements(migration)) {
      const droppedName = /drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"/iu.exec(
        statement,
      )?.[1];
      if (droppedName) {
        policies.delete(droppedName);
      } else {
        const policy = parseStoragePolicy(statement);
        policies.set(policy.policyName, policy);
      }
    }
  }

  return [...policies.values()].sort(byPolicyName);
};

const pgTapPlan = (sql: string) => {
  const declared = Number(/extensions\.plan\((\d+)\)/u.exec(sql)?.[1]);
  const actual = [
    ...sql.matchAll(/select\s+extensions\.(?!plan\b|finish\b)\w+\s*\(/giu),
  ].length;
  return { actual, declared };
};

describe("Supabase architecture audit source contract", () => {
  test("replays the historical storage policy ledger to the exact reviewed inventory", () => {
    expect(replayHistoricalStoragePolicyLedger()).toEqual(
      reviewedStoragePolicies.map(comparablePolicy).sort(byPolicyName),
    );
    expect(reviewedStoragePolicies).toHaveLength(21);
    expect(
      reviewedStoragePolicies.every(
        ({ intendedOwner }) => intendedOwner.length > 0,
      ),
    ).toBe(true);
  });

  test("recreates the exact 21-policy surface with full predicate contracts", () => {
    expect(storagePolicyCreates(storageMigration).sort(byPolicyName)).toEqual(
      reviewedStoragePolicies.map(comparablePolicy).sort(byPolicyName),
    );
    expect(storagePolicyContractBuckets(storageMigration)).toEqual(
      reviewedStoragePolicies
        .map(({ policyName, bucketId }) => ({ policyName, bucketId }))
        .sort(byPolicyName),
    );
  });

  test("uses one fixed-search-path live deparser for snapshot and drift", () => {
    const liveCatalogDefinition =
      /create\s+or\s+replace\s+function\s+app_private\.storage_object_policy_live_catalog\(\)[\s\S]*?\$\$;/iu.exec(
        storageMigration,
      )?.[0];

    expect(liveCatalogDefinition).toContain("SET search_path = ''");
    expect(
      storageMigration.match(/pg_get_expr\(policy\.polqual/gu) ?? [],
    ).toHaveLength(1);
    expect(
      storageMigration.match(/pg_get_expr\(policy\.polwithcheck/gu) ?? [],
    ).toHaveLength(1);
    expect(storageMigration).toContain(
      "JOIN app_private.storage_object_policy_live_catalog() AS policy",
    );
    expect(
      storageMigration.match(
        /FROM app_private\.storage_object_policy_live_catalog\(\)/gu,
      ) ?? [],
    ).toHaveLength(2);
  });

  test("converges client-reachable policy residue and is safe to reapply", () => {
    expect(storageMigration).toContain("DROP POLICY %I ON storage.objects");
    expect(storageMigration).toContain("WHERE is_client_reachable");
    expect(storageMigration).toContain(
      "CREATE TABLE IF NOT EXISTS app_private.storage_object_policy_contract",
    );
    expect(storageMigration).toContain(
      "TRUNCATE TABLE app_private.storage_object_policy_contract",
    );
  });

  test("keeps relation and column ACL reconciliation independent from storage", () => {
    expect(relationMigration).not.toContain("storage_object_policy");
    expect(relationMigration).toContain(
      "This relation/column ACL layer is intentionally independent",
    );
  });

  test("keeps both new pgTAP plans exact", () => {
    expect(pgTapPlan(storagePgtap)).toEqual({ actual: 25, declared: 25 });
    expect(pgTapPlan(relationPgtap)).toEqual({ actual: 16, declared: 16 });
  });

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
      "no reviewed policy snapshot stores an unqualified public relation reference",
      "authority rechecks stay schema-qualified",
    ]) {
      expect(storagePgtap).toContain(requiredProbe);
    }
  });
});
