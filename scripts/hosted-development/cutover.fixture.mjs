import assert from "node:assert/strict";
import { expectedVersions } from "../production/app-release-checks.mjs";
import { ledgerDigest } from "../production/final-schema-manifest.mjs";
import { cutoverConfig, target } from "./cutover-authority.mjs";

export const candidate = "a".repeat(40);
export const base = "b".repeat(40);
export const merged = "c".repeat(40);
export const tree = "d".repeat(40);
export const clock = 1_800_000_000_000;
export const versions = expectedVersions(process.cwd());

export function environment(phase = "prepare") {
  const database = new URL(
    `postgres://db.${target.database}.supabase.co/postgres`,
  );
  database.username = "postgres";
  database.password = "test-password";
  return {
    CUTOVER_PHASE: phase,
    ACCEPTED_SHA: candidate,
    GITHUB_SHA: ["bootstrap", "prepare"].includes(phase) ? candidate : merged,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: target.repository,
    GITHUB_REPOSITORY_ID: String(target.repositoryId),
    GITHUB_REF: ["bootstrap", "prepare"].includes(phase)
      ? "refs/heads/codex/reviewed-fixture"
      : "refs/heads/development",
    GITHUB_RUN_ID: ["bootstrap", "prepare"].includes(phase) ? "100" : "101",
    GITHUB_ACTOR: "fixture-owner",
    CUTOVER_PR_NUMBER: "867",
    CUTOVER_PREPARE_RUN_ID: ["bootstrap", "prepare"].includes(phase)
      ? ""
      : "100",
    CONFIRMATION: `cutover-development:${phase}:${candidate}`,
    EXTERNAL_WRITERS_CONFIRMATION: `external-writers-stopped:${candidate}`,
    SUPABASE_PROJECT_ID: target.database,
    SUPABASE_URL: `https://${target.database}.supabase.co`,
    DEVELOPMENT_DATABASE_URL: database.href,
    SUPABASE_SECRET_KEY: "sb_secret_fictional",
    CSF_DEVELOPMENT_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional",
    GH_TOKEN: "fictional-github",
    VERCEL_TOKEN: "fictional-vercel",
    VERCEL_AUTOMATION_BYPASS_SECRET: "fictional-bypass",
    VERCEL_ROOT_PROJECT_ID: target.project,
    VERCEL_TEAM_ID: target.team,
  };
}

export function preparedReceipt() {
  return {
    format: 1,
    candidate,
    controller: candidate,
    base,
    tree,
    pr: 867,
    run: "100",
    maintenanceRun: "100",
    observer: "fixture-owner",
    createdAt: clock,
    expiresAt: clock + 3_600_000,
    project: target.project,
    team: target.team,
    database: target.database,
    domain: target.domain,
    holdBranch: target.holdBranch,
    priorAlias: "dpl_Prior",
    phase: "prepared",
    targetDigest: ledgerDigest(versions),
    maintenance: {
      id: "dpl_Maintenance",
      origin: "https://maintenance.vercel.app",
    },
  };
}

export function controllerFixture(phase = "prepare") {
  const config = cutoverConfig(environment(phase));
  const receipt = preparedReceipt();
  const state = {
    domain: ["bootstrap", "prepare"].includes(phase)
      ? target.branch
      : target.holdBranch,
    alias: ["bootstrap", "prepare"].includes(phase)
      ? "dpl_Prior"
      : "dpl_Maintenance",
    current: ["bootstrap", "prepare"].includes(phase) ? base : merged,
    blocked: !["bootstrap", "prepare"].includes(phase),
    retention: false,
    records: [],
    writes: [],
    reads: [],
    apiChanges: new Map(),
    active: [],
    schemaFailure: false,
    bootstrapped: false,
    postOpenDrift: false,
    deployments: new Map(),
  };
  state.deployments.set("dpl_Prior", {
    id: "dpl_Prior",
    projectId: target.project,
    target: null,
    meta: { githubCommitSha: base, githubCommitRef: target.branch },
  });
  const getGit = (path) => {
    if (path === "")
      return { id: target.repositoryId, full_name: target.repository };
    if (path === "/environments/development")
      return {
        id: 55,
        name: "development",
        protection_rules: [
          {
            type: "required_reviewers",
            prevent_self_review: false,
            reviewers: [{ type: "User", reviewer: { login: config.actor } }],
          },
        ],
      };
    if (path === `/collaborators/${config.actor}/permission`)
      return { permission: "admin" };
    if (path === `/actions/runs/${config.run}`)
      return {
        path: target.workflow,
        head_sha: config.controller,
        event: "workflow_dispatch",
        run_attempt: 1,
        status: "in_progress",
        actor: { login: config.actor },
        triggering_actor: { login: config.actor },
        repository: { id: target.repositoryId },
        head_branch: config.ref.replace("refs/heads/", ""),
      };
    if (path === `/actions/runs/${config.run}/approvals`)
      return [
        {
          state: "approved",
          user: { login: config.actor },
          environments: [{ id: 55, name: "development" }],
        },
      ];
    if (path === "/pulls/867")
      return {
        number: 867,
        state: state.current === base ? "open" : "closed",
        merged: state.current !== base,
        merge_commit_sha: merged,
        head: {
          sha: candidate,
          ref: "codex/reviewed-fixture",
          repo: { id: target.repositoryId },
        },
        base: {
          ref: target.branch,
          sha: base,
          repo: { id: target.repositoryId },
        },
      };
    if (path === "/git/ref/heads/development")
      return { object: { sha: state.current } };
    if (path === `/commits/${candidate}`)
      return { sha: candidate, commit: { tree: { sha: tree } } };
    if (path.startsWith("/commits/"))
      return {
        sha: path.slice(9),
        commit: { tree: { sha: tree } },
        parents: [{ sha: base }, { sha: candidate }],
      };
    if (path.startsWith("/git/matching-refs/")) return [];
    if (path.startsWith("/compare/")) return { status: "ahead", behind_by: 0 };
    throw new Error(`Unexpected GitHub fixture path ${path}`);
  };
  const github = async (path) => {
    state.reads.push(path);
    const original = getGit(path);
    return state.apiChanges.has(path)
      ? state.apiChanges.get(path)(structuredClone(original))
      : original;
  };
  const vercel = async (path, body, method) => {
    if (body) state.writes.push({ kind: "vercel", path, body, method });
    else state.reads.push(path);
    if (path === `/v9/projects/${target.project}`)
      return {
        id: target.project,
        accountId: target.team,
        link: {
          type: "github",
          repoId: target.repositoryId,
          productionBranch: "main",
        },
      };
    if (path.startsWith(`/v9/projects/${target.project}/domains?`))
      return {
        domains: [{ name: target.domain, gitBranch: state.domain }],
        pagination: {},
      };
    if (path.endsWith(`/domains/${target.domain}`)) {
      if (body) {
        assert.equal(body.gitBranch, target.holdBranch);
        state.domain = body.gitBranch;
      }
      return { name: target.domain, verified: true, gitBranch: state.domain };
    }
    if (path === `/v4/aliases/${target.domain}`)
      return {
        alias: target.domain,
        projectId: target.project,
        deploymentId: state.alias,
      };
    if (path.startsWith("/v6/deployments?"))
      return { deployments: state.active, pagination: {} };
    if (path === "/v13/deployments" && body) {
      const id =
        body.meta.developmentCutover === "maintenance"
          ? "dpl_Maintenance"
          : "dpl_Application";
      const deployment = {
        id,
        url:
          id === "dpl_Maintenance"
            ? "maintenance.vercel.app"
            : "application.vercel.app",
        projectId: target.project,
        target: null,
        meta: {
          ...body.meta,
          ...(body.gitSource
            ? {
                githubCommitSha: body.gitSource.sha,
                githubCommitRef: body.gitSource.ref,
              }
            : {}),
        },
        gitSource: body.gitSource,
        alias: [],
        readyState: "READY",
      };
      state.deployments.set(id, deployment);
      return deployment;
    }
    if (path.startsWith("/v13/deployments/"))
      return state.deployments.get(path.split("/").at(-1));
    if (/^\/v2\/deployments\/dpl_[A-Za-z]+\/aliases$/u.test(path) && body) {
      assert.equal(body.alias, target.domain);
      state.alias = path.split("/")[3];
      return {};
    }
    throw new Error(`Unexpected Vercel fixture path ${path}`);
  };
  const query = (_url, sql) => {
    if (sql.includes("SELECT 'request-fence-bootstrap-applied'")) {
      state.writes.push({ kind: "bootstrap", sql });
      state.bootstrapped = true;
      return "request-fence-bootstrap-applied";
    }
    if (sql.includes("SELECT 'development-bootstrap-transactions-settled'"))
      return "development-bootstrap-transactions-settled";
    if (sql.includes("SELECT 'development-bootstrap-verified'"))
      return "development-bootstrap-verified";
    if (
      sql.includes("ALTER ROLE authenticator") &&
      sql.includes("pg_advisory_xact_lock(592043,1)")
    ) {
      state.blocked = sql.includes(
        "ALTER ROLE authenticator SET pgrst.app_settings.maintenance_write_block",
      );
      state.writes.push({ kind: "guard", enabled: state.blocked });
      return "";
    }
    if (
      sql.startsWith("SELECT cron.alter_job") ||
      sql.includes("cron.alter_job(jobid,active:=true)")
    ) {
      state.retention = sql.includes("active:=true");
      state.writes.push({ kind: "retention", enabled: state.retention });
      return "";
    }
    if (sql.includes("DO $request_barrier$")) return "";
    if (sql.includes("json_agg(version::text"))
      return JSON.stringify(
        phase === "bootstrap"
          ? versions.slice(0, state.bootstrapped ? 688 : 687)
          : phase === "prepare"
            ? versions.slice(0, 688)
            : versions,
      );
    if (sql.includes("maintenance-preflight-verified")) {
      assert.equal(state.blocked, true);
      assert.equal(state.retention, false);
      return state.schemaFailure ? "invalid" : "maintenance-preflight-verified";
    }
    if (sql.includes("FROM cron.job WHERE active")) return "t";
    throw new Error("Unexpected SQL fixture statement");
  };
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, "error");
    if (String(url).includes("/rest/v1/system_banners?")) {
      if (options.method === "GET") return Response.json([]);
      assert.equal(options.method, "PATCH");
      if (!state.blocked && state.postOpenDrift) {
        state.alias = "dpl_Unrelated";
        throw new Error("synthetic transport failure");
      }
      return state.blocked
        ? Response.json({ code: "25006" }, { status: 400 })
        : new Response(null, { status: 204 });
    }
    if (String(url).endsWith("/maintenance-health.txt"))
      return new Response(
        `lets-assist-development-maintenance:${candidate}:100`,
      );
    if (String(url).endsWith("/api/status?deep=0"))
      return Response.json({
        service: "lets-assist",
        environment: "preview",
        version: merged,
        deep: false,
        checks: [
          {
            name: "workers",
            details: {
              csfControlMode: "database",
              csfWorkbookRefresh: false,
              csfImportCommit: false,
              csfCommunications: false,
              csfScheduledPostPublisher: false,
              csfPublicationNotifications: false,
              autoPublishHours: false,
              organizationCalendarSync: false,
              organizationSheetSync: false,
              projectCancellationWorker: false,
              publicImageCleanup: false,
              csfOperationalAlerts: false,
            },
          },
        ],
      });
    throw new Error("Unexpected HTTP fixture request");
  };
  return {
    config,
    state,
    receipt,
    github,
    vercel,
    query,
    fetcher,
    dependencies: {
      github,
      vercel,
      query,
      fetcher,
      record: (value) => state.records.push(structuredClone(value)),
      now: () => clock,
      pause: async () => {},
      loadReceipt: async () => structuredClone(receipt),
    },
  };
}
