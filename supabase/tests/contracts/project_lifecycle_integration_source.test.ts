import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("combined project lifecycle source contract", () => {
  test("cancellation owns only its transactional RPC while other status writes retain exact CAS proof", () => {
    const lifecycle = read("app/projects/[id]/server/lifecycle.ts");
    const statusAction = sliceBetween(
      lifecycle,
      "export async function updateProjectStatus(",
      "export async function cloneProject(",
    );

    expect(statusAction.match(/cancel_project_transactional/g)).toHaveLength(1);
    expect(statusAction).not.toContain("enqueue_project_cancellation_job");
    expect(statusAction).not.toContain('from("project_cancellation_jobs")');
    expect(statusAction).toContain('.eq("status", project.status)');
    expect(statusAction).toContain("updatedProject.id !== projectId");
    expect(statusAction).toMatch(
      /receipt\.outcome === "cancelled"[\s\S]*removeCalendarEventForProject/,
    );
    expect(statusAction).toMatch(
      /receipt\.outcome === "cancelled"[\s\S]*receipt\.jobStatus === "pending"[\s\S]*fetch\(/,
    );
  });

  test("unreject and cancellation share a deadlock-safe project boundary and active membership rule", () => {
    const unrejectMigration = read(
      "supabase/migrations/20260812100100_atomic_signup_unreject_capacity.sql",
    );
    const cancellationMigration = read(
      "supabase/migrations/20260812100500_project_cancellation_hostile_review_hardening.sql",
    );
    const unreject = sliceBetween(
      unrejectMigration,
      "CREATE OR REPLACE FUNCTION public.unreject_project_signup_with_capacity(",
      "REVOKE ALL ON FUNCTION public.unreject_project_signup_with_capacity",
    );
    const cancellation = sliceBetween(
      cancellationMigration,
      "CREATE FUNCTION public.cancel_project_transactional(",
      "COMMENT ON FUNCTION public.cancel_project_transactional",
    );

    const slotLock = unreject.indexOf("pg_advisory_xact_lock");
    const projectLock = unreject.indexOf(
      "-- Lock the project before the signup",
    );
    const signupLock = unreject.indexOf("-- Lock and refresh the exact signup");

    expect(slotLock).toBeGreaterThanOrEqual(0);
    expect(projectLock).toBeGreaterThan(slotLock);
    expect(signupLock).toBeGreaterThan(projectLock);
    expect(unreject.slice(projectLock, signupLock)).toContain("FOR UPDATE");
    expect(unreject.slice(signupLock)).toContain("FOR UPDATE");
    expect(cancellation).toContain(
      "COALESCE(members.status, 'active') = 'active'",
    );
    expect(cancellation).toContain("FOR SHARE OF members");
    expect(cancellation).toMatch(
      /FROM public\.projects AS projects[\s\S]*FOR UPDATE;[\s\S]*SET status = 'cancelled'/,
    );
  });

  test("ending recurrence delegates child cancellation instead of competing with the ledger", () => {
    const lifecycle = read("app/projects/[id]/server/lifecycle.ts");
    const updateAction = lifecycle.slice(
      lifecycle.indexOf("export async function updateProject("),
    );

    expect(updateAction).toMatch(/rpc\(\s*"cancel_project_transactional"/);
    expect(updateAction).not.toContain('status: "cancelled"');
    expect(updateAction).toMatch(
      /receipt\.outcome === "cancelled"[\s\S]*removeCalendarEventForProject\(occurrence\.id\)/,
    );
  });

  test("the callable catalog retains both invoker wrappers without SECURITY DEFINER exceptions", () => {
    const audit = read("scripts/audit-supabase-architecture.sh");
    const aclTest = read(
      "supabase/tests/database/public_function_acl_allowlist.test.sql",
    );
    const boundaryMigration = read(
      "supabase/migrations/20260812104754_harden_project_transaction_rpc_boundaries.sql",
    );
    const securityDefinerAudit = sliceBetween(
      audit,
      'unexpected_security_definer_exec="$(',
      'fail_if_rows "client EXECUTE grants on public SECURITY DEFINER functions"',
    );

    for (const signature of [
      "public.cancel_project_transactional(uuid,text)",
      "public.unreject_project_signup_with_capacity(uuid)",
    ]) {
      expect(audit).toContain(signature);
      expect(aclTest).toContain(signature);
    }

    expect(securityDefinerAudit).not.toContain(
      "unreject_project_signup_with_capacity",
    );
    expect(securityDefinerAudit).not.toContain("cancel_project_transactional");
    expect(boundaryMigration).toContain(
      "ALTER FUNCTION public.cancel_project_transactional(uuid, text)\n  SET SCHEMA private",
    );
    expect(boundaryMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.cancel_project_transactional(",
    );
    expect(boundaryMigration).toContain(
      "ALTER FUNCTION public.unreject_project_signup_with_capacity(uuid)\n  SET SCHEMA private",
    );
    expect(boundaryMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.unreject_project_signup_with_capacity(",
    );
    expect(
      boundaryMigration.match(
        /LANGUAGE sql\nSECURITY INVOKER\nSET search_path = ''/g,
      ),
    ).toHaveLength(2);
    expect(boundaryMigration.match(/SET search_path = ''/g)).toHaveLength(2);
    expect(boundaryMigration).toContain(
      "DROP INDEX public.projects_id_organization_id_uidx",
    );
    expect(boundaryMigration).not.toContain(
      "DROP INDEX public.projects_id_organization_id_key",
    );
  });

  test("the tenant FK audit permits only the guarded cancellation snapshot ledger", () => {
    const audit = read("scripts/audit-supabase-architecture.sh");
    const retention = read(
      "supabase/migrations/20260812100700_preserve_cancellation_evidence_parent_deletion.sql",
    );
    const tenantFkAudit = sliceBetween(
      audit,
      'missing_org_fk="$(',
      'fail_if_rows "organization_id columns without tenant FK constraints"',
    );
    const exceptionCatalog = sliceBetween(
      tenantFkAudit,
      "tenant_fk_exceptions(",
      "org_tables as (",
    );
    const exceptionTargets = [
      ...exceptionCatalog.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'/g),
    ].map((match) => match.slice(1));

    expect(exceptionTargets).toEqual([["public", "project_cancellation_jobs"]]);
    expect(exceptionCatalog).toContain(
      "'project_cancellation_jobs_snapshot_identifiers_match'",
    );
    expect(exceptionCatalog).toContain(
      "'project_cancellation_jobs_live_organization_id_fkey'",
    );
    expect(exceptionCatalog).toContain("'organization_id_snapshot'");
    expect(exceptionCatalog).toContain("'live_organization_id'");

    expect(tenantFkAudit).toContain("direct_tenant_fks");
    expect(tenantFkAudit).toContain("pg_get_expr");
    expect(tenantFkAudit).toContain(
      "NOT (organization_id_snapshot IS DISTINCT FROM organization_id)",
    );
    expect(tenantFkAudit).toContain("constraints.confdeltype = 'n'");
    expect(tenantFkAudit).toContain(
      "live_attributes.attname = exception.live_column_name",
    );
    expect(tenantFkAudit).toContain(
      "parent_relations.relname = 'organizations'",
    );
    expect(tenantFkAudit).toContain("parent_attributes.attname = 'id'");
    expect(tenantFkAudit).toContain("'invalid_exception'");
    expect(tenantFkAudit).toContain("'missing_fk'");

    expect(retention).toContain(
      "DROP CONSTRAINT project_cancellation_jobs_organization_id_fkey",
    );
    expect(retention).toMatch(
      /project_cancellation_jobs_snapshot_identifiers_match[\s\S]*organization_id_snapshot IS NOT DISTINCT FROM organization_id/,
    );
    expect(retention).toMatch(
      /project_cancellation_jobs_live_organization_id_fkey[\s\S]*FOREIGN KEY \(live_organization_id\)[\s\S]*REFERENCES public\.organizations\(id\) ON DELETE SET NULL/,
    );
  });

  test("branch foreign keys never SET NULL through a generated column", () => {
    const migrations = [
      "20260812100100_atomic_signup_unreject_capacity.sql",
      "20260812100200_enforce_project_schedule_validation.sql",
      "20260812100300_feedback_dispatch_phases.sql",
      "20260812100400_project_cancellation_durable_worker.sql",
      "20260812100500_project_cancellation_hostile_review_hardening.sql",
      "20260812100600_repair_project_signup_lifecycle_boundary.sql",
      "20260812100700_preserve_cancellation_evidence_parent_deletion.sql",
    ].map((file) => read(`supabase/migrations/${file}`));
    const source = migrations.join("\n");
    const generatedColumns = new Set(
      [
        ...source.matchAll(
          /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z0-9_]+)\s+uuid\s+GENERATED ALWAYS/gi,
        ),
      ].map((match) => match[1]),
    );
    const foreignKeys = [
      ...source.matchAll(
        /ADD CONSTRAINT\s+([a-z0-9_]+)\s+FOREIGN KEY\s*\(([^)]+)\)([\s\S]*?)(?=\s*ADD CONSTRAINT|;)/gi,
      ),
    ].map((match) => ({
      name: match[1],
      columns: match[2].split(",").map((column) => column.trim()),
      definition: match[0],
    }));

    expect(
      foreignKeys
        .filter(
          (foreignKey) =>
            foreignKey.columns.some((column) => generatedColumns.has(column)) &&
            /ON DELETE SET NULL\b/i.test(foreignKey.definition),
        )
        .map((foreignKey) => foreignKey.name),
    ).toEqual([]);
  });

  test("cancellation evidence uses immutable snapshots and nullable live parent references", () => {
    const retention = read(
      "supabase/migrations/20260812100700_preserve_cancellation_evidence_parent_deletion.sql",
    );
    const hardening = read(
      "supabase/migrations/20260812100500_project_cancellation_hostile_review_hardening.sql",
    );

    for (const column of [
      "project_id_snapshot",
      "organization_id_snapshot",
      "live_project_id",
      "live_organization_id",
    ]) {
      expect(retention).toContain(column);
    }
    expect(retention).toMatch(
      /project_cancellation_jobs_live_project_id_fkey[\s\S]*ON DELETE SET NULL/,
    );
    expect(retention).toMatch(
      /project_cancellation_deliveries_live_project_id_fkey[\s\S]*ON DELETE SET NULL/,
    );
    expect(hardening).toMatch(
      /project_cancellation_deliveries_job_id_fkey[\s\S]*ON DELETE RESTRICT/,
    );
    expect(retention).not.toContain(
      "DROP CONSTRAINT project_cancellation_deliveries_job_id_fkey",
    );
    expect(retention).toMatch(
      /UPDATE public\.project_cancellation_jobs[\s\S]*live_project_id = CASE[\s\S]*WHEN EXISTS \([\s\S]*FROM public\.projects/,
    );
    expect(retention).not.toContain("live_project_id = project_id,");
    expect(retention).not.toMatch(
      /project_cancellation_(?:jobs|deliveries)_(?:project|organization)_id_fkey[\s\S]{0,160}ON DELETE RESTRICT/,
    );
  });

  test("organization deletion proves database truth before removing its logo", () => {
    const profile = read("app/organization/[id]/settings/server/profile.ts");
    const deletion = profile.slice(
      profile.indexOf("export async function deleteOrganization("),
      profile.indexOf("export async function generateStaffLink("),
    );
    const databaseDelete = deletion.indexOf(".delete()");
    const deletionProof = deletion.indexOf('.select("id")', databaseDelete);
    const logoRemoval = deletion.indexOf('.from("organization-logos")');

    expect(databaseDelete).toBeGreaterThanOrEqual(0);
    expect(deletion.slice(0, databaseDelete)).not.toContain(
      '.from("organization-logos")',
    );
    expect(deletionProof).toBeGreaterThan(databaseDelete);
    expect(deletion).toContain(".maybeSingle()");
    expect(logoRemoval).toBeGreaterThan(deletionProof);
    expect(deletion).toContain("deletedOrganization.id !== organizationId");
  });

  test("signup approval stays open in progress without weakening cancellation", () => {
    const repair = read(
      "supabase/migrations/20260812100600_repair_project_signup_lifecycle_boundary.sql",
    );
    const boundary = sliceBetween(
      repair,
      "CREATE OR REPLACE FUNCTION app_private.enforce_project_signup_cancellation_boundary()",
      "REVOKE ALL ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()",
    );
    const cancellation = read(
      "supabase/migrations/20260812100500_project_cancellation_hostile_review_hardening.sql",
    );

    expect(repair).toContain("ALTER COLUMN status SET DEFAULT 'upcoming'");
    expect(boundary).toContain("v_project_status IS NULL");
    expect(boundary).toContain(
      "v_project_status NOT IN ('upcoming', 'in-progress')",
    );
    expect(boundary).toContain("FOR UPDATE");
    expect(cancellation).toContain(
      "IF v_project.status IS DISTINCT FROM 'upcoming' THEN",
    );
  });

  test("lifecycle cron routes expose aggregates rather than row or provider details", () => {
    const recurrenceRoute = read(
      "app/api/cron/generate-recurring-projects/route.ts",
    );
    const cancellationRoute = read(
      "app/api/cron/project-cancellations/route.ts",
    );
    const feedbackRoute = read(
      "app/api/cron/project-feedback-followups/route.ts",
    );

    expect(recurrenceRoute).toContain("failedProjects: result.errors.length");
    expect(recurrenceRoute).not.toContain("errors: result.errors");
    expect(recurrenceRoute).not.toContain("error.message");
    expect(cancellationRoute).toContain("Aggregates only");
    expect(feedbackRoute).toContain("Aggregates only");
  });

  test("integrated organization fixtures use canonical six-digit join codes", () => {
    const files = [
      "project_signup_unreject_capacity.test.sql",
      "project_cancellation_durable_worker.test.sql",
      "project_cancellation_worker_concurrency.test.sql",
      "project_lifecycle_integration_concurrency.test.sql",
    ];
    const organizationInsert =
      /INSERT INTO public\.organizations\s*\(\s*id,\s*name,\s*username,\s*type,\s*join_code\s*\)\s*VALUES([\s\S]*?);/g;
    const organizationTuple =
      /\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*'([^']+)'\s*\)/g;

    for (const file of files) {
      const source = read(`supabase/tests/database/${file}`);
      const joinCodes = [...source.matchAll(organizationInsert)].flatMap(
        ([, values]) =>
          [...values.matchAll(organizationTuple)].map((match) => match[1]),
      );

      expect(joinCodes.length, file).toBeGreaterThan(0);
      expect(
        joinCodes.every((joinCode) => /^\d{6}$/.test(joinCode)),
        `${file}: ${joinCodes.join(", ")}`,
      ).toBe(true);
    }
  });

  test("every integrated pgTAP plan exactly matches its authored assertions", () => {
    const files = [
      "project_signup_unreject_capacity.test.sql",
      "project_signup_unreject_capacity_concurrency.test.sql",
      "project_schedule_validation.test.sql",
      "project_feedback_requests.test.sql",
      "project_cancellation_durable_worker.test.sql",
      "project_cancellation_worker_concurrency.test.sql",
      "project_cancellation_worker_lock_order.test.sql",
      "project_lifecycle_integration_concurrency.test.sql",
      "project_signup_lifecycle_boundary.test.sql",
      "public_function_acl_allowlist.test.sql",
    ];
    const assertion =
      /extensions\.(?:has_function|is|lives_ok|ok|results_eq|throws_ok)\(/g;

    for (const file of files) {
      const source = read(`supabase/tests/database/${file}`);
      const planned = Number(
        source.match(/extensions\.plan\((\d+)\)/)?.[1] ?? "NaN",
      );
      const authored = source.match(assertion)?.length ?? 0;

      expect(Number.isNaN(planned), file).toBe(false);
      expect(authored, file).toBe(planned);
    }
  });
});
