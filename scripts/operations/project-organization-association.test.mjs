import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  statSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateAssociationInput,
  associationOperationFingerprint,
  buildAssociationInspectionSql,
  buildAssociationApplySql,
  validateAssociationResult,
  prepareAssociationArtifacts,
  recordAssociationResult,
  main,
} from "./project-organization-association.mjs";
const uid = (n) => `e9000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function input() {
  return {
    requestId: uid(1),
    actorId: uid(2),
    targetOrganization: { id: uid(3), username: "troop941" },
    projects: [4, 5].map((n) => ({
      id: uid(n),
      expectedCreatorId: uid(2),
      expectedOrganizationId: null,
      expectedFingerprint: "a".repeat(64),
      expectedCounts: { signups: 1, certificates: 0 },
    })),
  };
}
function result(config = input()) {
  const before = config.projects.map((p) => ({
    projectId: p.id,
    creatorId: p.expectedCreatorId,
    organizationId: null,
    fingerprint: p.expectedFingerprint,
    counts: p.expectedCounts,
  }));
  return {
    operation: "troop941-project-organization-association-v1",
    requestId: config.requestId,
    operationFingerprint: associationOperationFingerprint(config),
    mode: "apply",
    status: "applied",
    targetAuthorized: true,
    changedCount: 2,
    before,
    projects: before.map((p) => ({
      ...p,
      organizationId: config.targetOrganization.id,
    })),
  };
}
const roots = [];
function root() {
  const path = mkdtempSync(join(tmpdir(), "association-operation-"));
  roots.push(path);
  return path;
}
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("reviewed project organization association", () => {
  test("requires exactly two distinct ids and exact organization username", () => {
    for (const mutate of [
      (c) => c.projects.pop(),
      (c) => c.projects.push(c.projects[0]),
      (c) => (c.projects[1].id = c.projects[0].id),
      (c) => (c.targetOrganization.username = "other"),
      (c) => (c.projects[0].expectedOrganizationId = uid(7)),
    ]) {
      const c = input();
      mutate(c);
      expect(() => validateAssociationInput(c)).toThrow();
    }
  });
  test("rejects SQL fragments, unknown fields and noninteger counts", () => {
    for (const mutate of [
      (c) => (c.actorId = "';DELETE FROM projects;--"),
      (c) => (c.projects[0].expectedCounts.signups = 1.2),
      (c) => (c.extra = true),
      (c) => (c.targetOrganization.id = uid(1) + "'"),
      (c) => (c.projects[0].expectedFingerprint = "abc"),
    ]) {
      const c = input();
      mutate(c);
      expect(() => validateAssociationInput(c)).toThrow();
    }
  });
  test("inspection accepts missing fingerprints; apply requires reviewed fingerprints", () => {
    const c = input();
    c.projects[0].expectedFingerprint = null;
    expect(buildAssociationInspectionSql(c)).toContain("SELECT");
    expect(() => buildAssociationApplySql(c)).toThrow("fingerprint");
  });
  test("dry-run SQL has no writes and prints only hashes, counts, and ids", () => {
    const sql = buildAssociationInspectionSql(input());
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|CREATE)\b/);
    expect(sql).toContain("o.verified IS TRUE");
    expect(sql).toContain("m.status = 'active'");
    expect(sql).toContain("'fingerprint'");
    expect(sql).not.toContain("'title',");
  });
  test("apply refuses to generate SQL while the tenant association constraint is unresolved", () => {
    expect(() => buildAssociationApplySql(input())).toThrow(
      "project_signups_project_tenant_fkey",
    );
    expect(buildAssociationInspectionSql(input())).toContain(
      "'applySupported', false",
    );
    expect(buildAssociationInspectionSql(input())).toContain(
      "pg_get_constraintdef(oid)",
    );
  });
  test("operation hash is order-stable and binds every precondition", () => {
    const c = input();
    const baseline = associationOperationFingerprint(c);
    c.projects.reverse();
    expect(associationOperationFingerprint(c)).toBe(baseline);
    c.projects[0].expectedCounts.signups++;
    expect(associationOperationFingerprint(c)).not.toBe(baseline);
  });
  test("readback requires exact ids, target, actor, hashes and counts", () => {
    for (const mutate of [
      (r) => (r.projects[0].fingerprint = "b".repeat(64)),
      (r) => (r.projects[0].organizationId = null),
      (r) => (r.projects[0].creatorId = uid(7)),
      (r) => (r.projects[0].counts = { signups: 2, certificates: 0 }),
      (r) => (r.requestId = uid(8)),
      (r) => (r.operationFingerprint = "b".repeat(64)),
      (r) => (r.targetAuthorized = false),
      (r) => (r.mode = "fake"),
      (r) => (r.changedCount = 0),
      (r) => (r.before[0].organizationId = uid(8)),
    ]) {
      const r = result();
      mutate(r);
      expect(() => validateAssociationResult(input(), r)).toThrow();
    }
  });
  test("ambiguous-response reconciliation verifies already-target state without writes", () => {
    const r = result();
    r.mode = "inspection";
    delete r.before;
    const receipt = validateAssociationResult(input(), r);
    expect(receipt.status).toBe("reconciled_target");
    expect(receipt.before.every((p) => p.organizationId === null)).toBe(true);
  });
  test("SQL and receipts are owner-readable artifacts and apply creates no runnable file", () => {
    const dir = root();
    expect(() =>
      prepareAssociationArtifacts(input(), {
        root: dir,
        mode: "prepare-apply",
      }),
    ).toThrow("project_signups_project_tenant_fkey");
    const inspect = prepareAssociationArtifacts(input(), {
      root: dir,
      mode: "reconcile",
    });
    expect(statSync(inspect).mode & 0o777).toBe(0o600);
    expect(readFileSync(inspect, "utf8")).not.toContain(
      "UPDATE public.projects",
    );
    const receipt = recordAssociationResult(input(), result(), { root: dir });
    expect(statSync(receipt).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(receipt, "utf8")).before).toHaveLength(2);
  });
  test("refuses symlinked receipt directories", () => {
    const dir = root();
    symlinkSync(root(), join(dir, ".artifacts"));
    expect(() => prepareAssociationArtifacts(input(), { root: dir })).toThrow(
      "symlinks",
    );
  });
  test("CLI defaults to inspection and requires ignored owner-only JSON", () => {
    const dir = root();
    mkdirSync(join(dir, ".artifacts"));
    const path = join(dir, ".artifacts", "input.json");
    writeFileSync(path, JSON.stringify(input()), { mode: 0o600 });
    const sql = main(["--input", path], dir);
    expect(readFileSync(sql, "utf8")).not.toContain("UPDATE public.projects");
    expect(() => main(["--input", join(dir, "outside.json")], dir)).toThrow(
      ".artifacts",
    );
    const publicPath = join(dir, ".artifacts", "public.json");
    writeFileSync(publicPath, JSON.stringify(input()), { mode: 0o644 });
    expect(() => main(["--input", publicPath], dir)).toThrow("owner-only");
  });
});

const isolatedContainer = process.env.ASSOCIATION_TEST_CONTAINER;
test.skipIf(!isolatedContainer)(
  "isolated database proves reassociation is blocked and preserves both projects",
  async () => {
    if (
      !/^supabase_db_lets-assist-csf-browser-[a-zA-Z0-9_-]+$/.test(
        isolatedContainer,
      )
    )
      throw new Error(
        "Only an explicitly owned isolated local container may run this fixture",
      );
    const { execFileSync } = await import("node:child_process");
    const sql = `BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES ('${uid(2)}','authenticated','authenticated','association-boundary@local.test',now(),'{}','{"username":"association_boundary"}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code,verified) VALUES ('${uid(3)}','Synthetic association boundary','association_boundary','nonprofit','993672',true);
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status) VALUES ${[4, 5].map((n) => `('${uid(n)}','${uid(2)}','Synthetic project ${n}','Local','Protected description','oneTime','manual','{"oneTime":{"date":"2027-01-20","startTime":"10:00","endTime":"12:00","volunteers":10}}','upcoming')`).join(",")};
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES ${[4, 5].map((n) => `('${uid(n + 10)}','${uid(n)}','${uid(2)}','oneTime','approved')`).join(",")};
INSERT INTO public.certificates(id,project_id,signup_id,project_title,is_certified,event_start,event_end,check_in_method,creator_id,type) VALUES ('${uid(25)}','${uid(4)}','${uid(14)}','Protected certificate',true,'2027-01-20T18:00:00Z','2027-01-20T20:00:00Z','manual','${uid(2)}','verified');
SELECT extensions.is((SELECT condeferrable FROM pg_constraint WHERE conrelid='public.project_signups'::regclass AND conname='project_signups_project_tenant_fkey'),false,'tenant FK is immediate');
SELECT extensions.throws_like($test$UPDATE public.projects SET organization_id='${uid(3)}' WHERE id IN ('${uid(4)}','${uid(5)}')$test$,'%violates foreign key constraint "project_signups_project_tenant_fkey"%','project-only reassociation is rejected');
SELECT extensions.is((SELECT count(*)::integer FROM public.projects WHERE id IN ('${uid(4)}','${uid(5)}') AND organization_id IS NULL),2,'both project associations remain unchanged');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_signups WHERE project_id IN ('${uid(4)}','${uid(5)}') AND organization_id IS NULL AND status='approved'),2,'signup identity and attendance remain unchanged');
SELECT extensions.is((SELECT count(*)::integer FROM public.projects WHERE id IN ('${uid(4)}','${uid(5)}') AND creator_id='${uid(2)}'),2,'both coordinators remain unchanged');
SELECT extensions.is((SELECT project_title FROM public.certificates WHERE id='${uid(25)}'),'Protected certificate','certificate remains unchanged');
SELECT * FROM extensions.finish();
ROLLBACK;`;
    const output = execFileSync(
      "docker",
      [
        "exec",
        "-i",
        isolatedContainer,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: sql, encoding: "utf8", timeout: 30000 },
    );
    expect(output).toContain("1..6");
    expect(output).not.toMatch(/not ok|Looks like you failed/);
    expect(output).toContain("ROLLBACK");
  },
);
