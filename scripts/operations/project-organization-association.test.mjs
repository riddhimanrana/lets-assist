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
    tenantAligned: true,
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
    noopCount: 0,
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
  test("apply updates both tenant coordinates with immediate constraints enabled", () => {
    const sql = buildAssociationApplySql(input());
    expect(sql).toContain("WITH changed_projects AS");
    expect(sql).toContain(
      "UPDATE public.project_signups s SET organization_id",
    );
    expect(sql).toContain("FOR SHARE");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("project expected state changed");
    expect(sql).toContain("protected attendance or project state changed");
    expect(sql).not.toMatch(/ALTER TABLE|DISABLE TRIGGER|SET CONSTRAINTS/);
    expect(buildAssociationInspectionSql(input())).toContain(
      "'applySupported', true",
    );
    expect(sql).not.toContain("- 'updated_at'");
    expect(sql).toContain("'publicationOutbox'");
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
      (r) => (r.noopCount = 2),
      (r) => (r.projects[0].tenantAligned = false),
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
  test("SQL and receipts are owner-readable artifacts and prevent blind apply retries", () => {
    const dir = root();
    const apply = prepareAssociationArtifacts(input(), {
      root: dir,
      mode: "prepare-apply",
    });
    expect(statSync(apply).mode & 0o777).toBe(0o600);
    expect(readFileSync(apply, "utf8")).toContain("UPDATE public.projects");
    expect(() =>
      prepareAssociationArtifacts(input(), {
        root: dir,
        mode: "prepare-apply",
      }),
    ).toThrow("never blindly retry");
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
  "isolated database proves atomic association, refusals, noops and preserved awards",
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
    const config = input();
    const inspection = buildAssociationInspectionSql(config).replace(
      /;\s*$/,
      "",
    );
    const applyBlock = buildAssociationApplySql(config)
      .match(/DO \$association\$[\s\S]*?\$association\$;/)[0]
      .replace(
        /v_config jsonb := .*?::jsonb;/,
        "v_config jsonb := (SELECT value FROM association_test_config);",
      );
    const sql = `BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES ('${uid(2)}','authenticated','authenticated','association-boundary@local.test',now(),'{}','{"username":"association_boundary"}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code,verified) VALUES ('${uid(3)}','Synthetic association boundary','troop941','nonprofit','993672',true), ('${uid(30)}','Other synthetic organization','association_other','nonprofit','993673',true);
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES ('${uid(3)}','${uid(2)}','admin','active');
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status) VALUES ${[4, 5].map((n) => `('${uid(n)}','${uid(2)}','Synthetic project ${n}','Local','Protected description','oneTime','manual','{"oneTime":{"date":"2027-01-20","startTime":"10:00","endTime":"12:00","volunteers":10}}','upcoming')`).join(",")};
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES ${[4, 5].map((n) => `('${uid(n + 10)}','${uid(n)}','${uid(2)}','oneTime','approved')`).join(",")};
INSERT INTO public.certificates(id,project_id,signup_id,project_title,is_certified,event_start,event_end,check_in_method,creator_id,type) VALUES ('${uid(25)}','${uid(4)}','${uid(14)}','Protected certificate',true,'2027-01-20T18:00:00Z','2027-01-20T20:00:00Z','manual','${uid(2)}','verified');
INSERT INTO public.hours_publication_receipts(id,project_id,schedule_id,publish_key,request_key,request_hash,requested_by,certificate_count,email_work_count) VALUES ('${uid(26)}','${uid(4)}','oneTime','oneTime','hours-publication:v1:'||repeat('b',64),repeat('b',64),'${uid(2)}',1,1);
INSERT INTO public.hours_publication_email_outbox(id,receipt_id,certificate_id,idempotency_key) VALUES ('${uid(27)}','${uid(26)}','${uid(25)}','association-proof-email');
CREATE TEMP TABLE association_initial AS ${inspection};
CREATE TEMP TABLE association_test_config AS SELECT jsonb_set('${JSON.stringify(config)}'::jsonb,'{projects}',
 (SELECT jsonb_agg(jsonb_build_object('id',p->>'projectId','expectedCreatorId',p->>'creatorId','expectedOrganizationId',null,'expectedFingerprint',p->>'fingerprint','expectedCounts',p->'counts') ORDER BY p->>'projectId') FROM association_initial, jsonb_array_elements(result->'projects') p)) AS value;
CREATE TEMP TABLE association_expected AS SELECT value FROM association_test_config;
SELECT extensions.is((SELECT condeferrable FROM pg_constraint WHERE conrelid='public.project_signups'::regclass AND conname='project_signups_project_tenant_fkey'),false,'tenant FK remains immediate');

UPDATE association_test_config SET value=jsonb_set(value,'{projects,1,expectedFingerprint}',to_jsonb(repeat('c',64)));
SELECT extensions.throws_ok($test$${applyBlock}$test$,'P0001','project expected state changed','one stale project refuses whole operation');
SELECT extensions.is((SELECT count(*)::integer FROM public.projects WHERE id IN ('${uid(4)}','${uid(5)}') AND organization_id IS NULL),2,'neither project changed after stale fingerprint');
UPDATE association_test_config SET value=(SELECT value FROM association_expected);
UPDATE public.organization_members SET status='inactive' WHERE organization_id='${uid(3)}' AND user_id='${uid(2)}';
SELECT extensions.throws_ok($test$${applyBlock}$test$,'P0001','active organization admin required','revoked administrator cannot associate');
UPDATE public.organization_members SET status='active' WHERE organization_id='${uid(3)}' AND user_id='${uid(2)}';
UPDATE public.organizations SET verified=false WHERE id='${uid(3)}';
SELECT extensions.throws_ok($test$${applyBlock}$test$,'P0001','verified target organization changed','unverified organization cannot receive projects');
UPDATE public.organizations SET verified=true WHERE id='${uid(3)}';
WITH p AS (UPDATE public.projects SET organization_id='${uid(30)}' WHERE id='${uid(5)}' RETURNING id,organization_id) UPDATE public.project_signups s SET organization_id=p.organization_id FROM p WHERE s.project_id=p.id;
SELECT extensions.throws_ok($test$${applyBlock}$test$,'P0001','project expected state changed','unexpected existing organization refuses association');
SELECT extensions.ok((SELECT organization_id IS NULL FROM public.projects WHERE id='${uid(4)}'),'other project is untouched on organization conflict');
WITH p AS (UPDATE public.projects SET organization_id=NULL WHERE id='${uid(5)}' RETURNING id,organization_id) UPDATE public.project_signups s SET organization_id=p.organization_id FROM p WHERE s.project_id=p.id;

CREATE FUNCTION pg_temp.reject_second_association() RETURNS trigger LANGUAGE plpgsql AS $trigger$ BEGIN IF NEW.id='${uid(5)}' AND current_setting('app.reject_test_association',true)='on' THEN RAISE EXCEPTION 'injected second project failure'; END IF; RETURN NEW; END; $trigger$;
CREATE TRIGGER reject_test_association BEFORE UPDATE OF organization_id ON public.projects FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_second_association();
SELECT set_config('app.reject_test_association','on',true);
SELECT extensions.throws_ok($test$${applyBlock}$test$,'P0001','injected second project failure','failure while changing second project rolls back both');
SELECT extensions.is((SELECT count(*)::integer FROM public.projects WHERE id IN ('${uid(4)}','${uid(5)}') AND organization_id IS NULL),2,'both projects remain unassociated after write failure');
SELECT set_config('app.reject_test_association','off',true);
SELECT extensions.lives_ok($test$${applyBlock}$test$,'reviewed operation associates both projects');
SELECT extensions.is(current_setting('app.project_association_receipt')::jsonb->>'changedCount','2','receipt reports two changes');
SELECT extensions.ok((SELECT bool_and(organization_id='${uid(3)}') FROM public.projects WHERE id IN ('${uid(4)}','${uid(5)}')),'both project associations match target');
SELECT extensions.ok((SELECT bool_and(s.organization_id=p.organization_id AND s.cancellation_tenant_id=p.cancellation_tenant_id) FROM public.project_signups s JOIN public.projects p ON p.id=s.project_id WHERE p.id IN ('${uid(4)}','${uid(5)}')),'signup tenant coordinates remain aligned');
SELECT extensions.results_eq($test$SELECT p->>'projectId',p->>'fingerprint',p->'counts' FROM jsonb_array_elements(current_setting('app.project_association_receipt')::jsonb->'projects') p ORDER BY p->>'projectId'$test$,
 $test$SELECT p->>'projectId',p->>'fingerprint',p->'counts' FROM association_initial,jsonb_array_elements(result->'projects') p ORDER BY p->>'projectId'$test$,'all protected project/signup fields, certificates, waivers and outbox remain exact');
SELECT extensions.lives_ok($test$${applyBlock}$test$,'already-associated replay is a noop');
SELECT extensions.is(current_setting('app.project_association_receipt')::jsonb->>'changedCount','0','replay changes zero projects');
SELECT extensions.is(current_setting('app.project_association_receipt')::jsonb->>'noopCount','2','replay reports two noops');
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
    expect(output).not.toMatch(/not ok|Looks like you failed/);
    expect(output).toContain("1..17");
    expect(output).toContain("ROLLBACK");
  },
);
