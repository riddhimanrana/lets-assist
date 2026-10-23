import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, X509Certificate } from "node:crypto";
import {
  mkdtempSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rootCertificates } from "node:tls";
import { membershipPolicy as p } from "../production/membership-display-source.mjs";
import {
  createMembershipPreview,
  checkMembershipPreview,
  checkMembershipProductionBaseline,
  membershipAcceptanceOrigin,
  membershipPreviewPayload,
  verifyMembershipPreview,
  verifyPreviewReceipt,
  developmentCatalogQuery,
  verifyMembershipPreviewStatus,
  membershipPreviewConfig,
  readMembershipDevelopmentCatalog as readCatalogImplementation,
  verifyMembershipDevelopmentCa,
  membershipPreviewDiagnosticCode,
} from "./membership-display-preview.mjs";
import { shouldRunVercelBuild } from "../vercel-build-policy.mjs";
import {
  buildSyntheticAccounts,
  fixtureOrganizationPath,
  FIXTURE_MARKER,
} from "./csf-load-fixture.mjs";

const config = { sha: "a".repeat(40), run: "123" };
function deployment() {
  return {
    id: "dpl_Fictional",
    url: "fictional-preview.vercel.app",
    target: null,
    projectId: p.project,
    gitSource: { sha: config.sha, ref: "main", repoId: p.repositoryId },
    meta: {
      membershipDisplaySha: config.sha,
      membershipDisplayRun: config.run,
    },
    alias: ["fictional-preview.vercel.app"],
  };
}
function receipt() {
  return {
    ...verifyMembershipPreview(deployment(), config),
    project: p.project,
    database: p.database,
    development: p.development,
    priorProduction: "dpl_Prior",
    priorDevelopment: "dpl_Development",
    readiness: "READY",
  };
}
test("Preview explicitly prevents domain assignment and has only nonsecret context overrides", () => {
  const value = membershipPreviewPayload(config);
  assert.equal(value.autoAssignCustomDomains, false);
  assert.equal(value.target, undefined);
  assert.equal(value.gitSource.sha, config.sha);
  assert.equal(value.gitSource.ref, "main");
  assert.equal(value.env.SUPABASE_PROJECT_ID, p.database);
  assert.equal(value.env.CSF_SHEET_WRITEBACK_ENABLED, "false");
  assert.equal(value.env.ORG_SHEET_SYNC_WORKER_ENABLED, "false");
  assert.equal(value.env.ORG_CALENDAR_SYNC_WORKER_ENABLED, "false");
  assert.equal(value.env.AUTO_PUBLISH_ENABLED, "false");
  assert.equal(value.env.PROJECT_CANCELLATION_WORKER_ENABLED, "false");
  assert.equal(value.env.ORGANIZATION_SHEET_SYNC_ENABLED, undefined);
  assert.equal(value.env.CSF_WORKER_CONTROL_MODE, "environment");
  assert.equal(value.env.LETS_ASSIST_EXPLICIT_MEMBERSHIP_SHA, config.sha);
  for (const key of Object.keys(value.env))
    assert.doesNotMatch(key, /KEY|PASSWORD|TOKEN|SECRET/u);
  assert.deepEqual(value.env, value.build.env);
});
for (const [field, value] of Object.entries({
  id: "wrong",
  url: "lets-assist.com",
  projectId: "prj_Other",
  target: "production",
  gitSource: { sha: "b".repeat(40), ref: "main", repoId: p.repositoryId },
  meta: { membershipDisplaySha: config.sha, membershipDisplayRun: "124" },
  alias: ["dev.lets-assist.com"],
}))
  test("rejects changed immutable deployment " + field, () =>
    assert.throws(() =>
      verifyMembershipPreview({ ...deployment(), [field]: value }, config),
    ),
  );
test("rejects SHA mismatch, changed repository/ref and different existing deployment ID", () => {
  for (const source of [
    { sha: "b".repeat(40), ref: "main", repoId: p.repositoryId },
    { sha: config.sha, ref: "development", repoId: p.repositoryId },
    { sha: config.sha, ref: "main", repoId: "1" },
  ])
    assert.throws(() =>
      verifyMembershipPreview({ ...deployment(), gitSource: source }, config),
    );
  assert.throws(() =>
    verifyMembershipPreview(deployment(), config, "dpl_Other"),
  );
});
test("receipt binds immutable origin to exact source/run/nonproduction backend and both aliases", () =>
  verifyPreviewReceipt(receipt(), config));
for (const [field, value] of Object.entries({
  sha: "b".repeat(40),
  run: "124",
  database: "fotdmeakexgrkronxlof",
  project: "prj_Other",
  development: "b".repeat(40),
  deploymentId: "wrong",
  readiness: "pending",
  priorProduction: "wrong",
  priorDevelopment: "wrong",
}))
  test("rejects changed receipt " + field, () =>
    assert.throws(() =>
      verifyPreviewReceipt({ ...receipt(), [field]: value }, config),
    ),
  );
for (const origin of [
  "https://lets-assist.com",
  "http://fictional-preview.vercel.app",
  "https://fictional-preview.vercel.app.evil.test",
  "https://user:pass@fictional-preview.vercel.app",
  "https://fictional-preview.vercel.app:444",
  "https://fictional-preview.vercel.app/path",
  "https://fictional-preview.vercel.app/?secret=value",
  "https://fictional-preview.vercel.app/#fragment",
])
  test("refuses unreviewed target " + origin, () =>
    assert.throws(() => verifyPreviewReceipt({ ...receipt(), origin }, config)),
  );
test("default hosted target remains Development and cannot be overridden by an origin alone", () =>
  assert.equal(
    membershipAcceptanceOrigin({ CSF_APP_URL: "https://evil.test" }),
    "https://dev.lets-assist.com",
  ));

test("only an owned regular receipt in the protected full-mode job can select the immutable origin", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "membership-origin-"));
  const previous = process.cwd();
  const environment = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: p.repository,
    GITHUB_REPOSITORY_ID: p.repositoryId,
    GITHUB_WORKFLOW_REF: p.repository + "/" + p.workflow + "@refs/heads/main",
    RELEASE_SHA: config.sha,
    GITHUB_SHA: config.sha,
    GITHUB_RUN_ID: config.run,
    GH_TOKEN: "fictional",
    CONFIRMATION: "deploy-membership-display:" + config.sha,
    FIXTURE_CONFIRMATION: "test-existing-development-fixture:" + config.sha,
    CSF_HOSTED_ACCEPTANCE_MODE: "full",
    EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: p.database,
    CSF_MEMBERSHIP_PREVIEW_RECEIPT:
      ".artifacts/membership-display-preview.json",
  };
  try {
    process.chdir(directory);
    mkdirSync(".artifacts");
    const path = environment.CSF_MEMBERSHIP_PREVIEW_RECEIPT;
    writeFileSync(path, JSON.stringify(receipt()), { mode: 0o600 });
    assert.equal(
      membershipAcceptanceOrigin(environment),
      "https://fictional-preview.vercel.app",
    );
    assert.throws(() =>
      membershipAcceptanceOrigin({
        ...environment,
        CSF_HOSTED_ACCEPTANCE_MODE: "functional",
      }),
    );
    assert.throws(() =>
      membershipAcceptanceOrigin({
        ...environment,
        EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: "fotdmeakexgrkronxlof",
      }),
    );
    chmodSync(path, 0o666);
    assert.throws(() => membershipAcceptanceOrigin(environment));
    rmSync(path);
    writeFileSync("other.json", JSON.stringify(receipt()));
    symlinkSync(resolve("other.json"), path);
    assert.throws(() => membershipAcceptanceOrigin(environment));
  } finally {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});
test("explicit membership build is limited to exact Main Preview; other build paths keep their policy", () => {
  const input = {
    branch: "main",
    environment: "preview",
    commitSha: config.sha,
    explicitMembershipSha: config.sha,
  };
  assert.equal(shouldRunVercelBuild(input), true);
  for (const change of [
    { branch: "other" },
    { environment: "production" },
    { commitSha: "b".repeat(40) },
    { explicitMembershipSha: undefined },
  ])
    assert.equal(shouldRunVercelBuild({ ...input, ...change }), false);
});
test("database query is pinned to reviewed Development catalog, explicit read-only transaction and hashes", () => {
  const sql = developmentCatalogQuery(process.cwd());
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(sql, /count\(\*\)=729/u);
  assert.match(
    sql,
    /5683053e8fc69f99c841ece8d1c0f8447dba68a933369692a94ae1fc0703e90c/u,
  );
  assert.match(
    sql,
    /2540b33e3aab056607685cdb316ef3aa34930b74e4db9b5385cfd680381c652d/u,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|COPY)\s+(?:INTO|FROM|TABLE|ROLE)/u,
  );
});
test("catalog builder refuses altered committed baseline bytes", () =>
  assert.throws(() => developmentCatalogQuery("/unused", () => "{}")));

const databaseUrl = `postgresql://postgres:fictional-password@db.${p.database}.supabase.co:5432/postgres`;
const reviewedCa = (cwd) =>
  resolve(
    cwd,
    "scripts/hosted-development/membership-display-development-ca.pem",
  );
// The transport tests inject only the CA check; the actual committed-CA
// verifier is exercised independently below with public Node trust roots.
function readMembershipDevelopmentCatalog(uri, cwd, execute) {
  return readCatalogImplementation(uri, cwd, execute, reviewedCa);
}
test("the real CA verifier binds a single public CA to an owned regular committed file", () => {
  const bytes = Buffer.from(rootCertificates[0].trim() + "\n");
  const file = reviewedCa(process.cwd());
  const options = {
    stat: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      nlink: 1,
      uid: process.getuid(),
      mode: 0o644,
    }),
    realpath: () => file,
    read: () => bytes,
    execute: (command, args, opts) => {
      assert.equal(command, "git");
      assert.deepEqual(args, [
        "show",
        "HEAD:scripts/hosted-development/membership-display-development-ca.pem",
      ]);
      assert.equal(opts.cwd, process.cwd());
      return bytes;
    },
  };
  assert.equal(verifyMembershipDevelopmentCa(process.cwd(), options), file);
  for (const change of [
    { read: () => Buffer.from("untrusted") },
    { execute: () => Buffer.from("different committed public certificate") },
    { realpath: () => "/tmp/unreviewed-ca.pem" },
    { stat: () => ({ ...options.stat(), isSymbolicLink: () => true }) },
    { stat: () => ({ ...options.stat(), nlink: 2 }) },
    { stat: () => ({ ...options.stat(), uid: process.getuid() + 1 }) },
    { stat: () => ({ ...options.stat(), mode: 0o666 }) },
    {
      read: () => {
        throw new Error("missing public certificate");
      },
    },
  ])
    assert.throws(() =>
      verifyMembershipDevelopmentCa(process.cwd(), { ...options, ...change }),
    );
});
test("missing reviewed provider CA fails before any real client execution", () => {
  let calls = 0;
  assert.throws(() =>
    readCatalogImplementation(
      databaseUrl,
      "/nonexistent/membership-ca-fixture",
      () => {
        calls++;
        return "t";
      },
    ),
  );
  assert.equal(calls, 0);
});
test("the supplied Development CA retains its reviewed identity and valid self-signature", () => {
  const bytes = readFileSync(reviewedCa(process.cwd()));
  const certificate = new X509Certificate(bytes);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
  );
  assert.equal(
    certificate.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  assert.equal(certificate.ca, true);
  assert.equal(
    certificate.subject,
    "C=US\nST=Delware\nL=New Castle\nO=Supabase Inc\nCN=Supabase Root 2021 CA",
  );
  assert.equal(certificate.issuer, certificate.subject);
  assert.equal(certificate.validFrom, "Apr 28 10:56:53 2021 GMT");
  assert.equal(certificate.validTo, "Apr 26 10:56:53 2031 GMT");
  assert.equal(certificate.publicKey.asymmetricKeyType, "rsa");
  assert.equal(certificate.publicKey.asymmetricKeyDetails.modulusLength, 2048);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.equal(
    verifyMembershipDevelopmentCa(process.cwd()),
    reviewedCa(process.cwd()),
  );
});
test("missing Management token can use only the existing protected Development URL", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: p.repository,
    GITHUB_REPOSITORY_ID: p.repositoryId,
    GITHUB_WORKFLOW_REF: `${p.repository}/${p.workflow}@refs/heads/main`,
    GITHUB_SHA: config.sha,
    RELEASE_SHA: config.sha,
    GITHUB_RUN_ID: config.run,
    CONFIRMATION: `deploy-membership-display:${config.sha}`,
    FIXTURE_CONFIRMATION: `test-existing-development-fixture:${config.sha}`,
    GH_TOKEN: "fictional-github",
    VERCEL_TOKEN: "fictional-vercel",
    VERCEL_ROOT_PROJECT_ID: p.project,
    VERCEL_TEAM_ID: p.team,
    DEVELOPMENT_PROJECT_REF: p.database,
    VERCEL_AUTOMATION_BYPASS_SECRET: "fictional-bypass",
    SUPABASE_ACCESS_TOKEN: "",
  };
  assert.throws(() => membershipPreviewConfig(env));
  assert.equal(
    membershipPreviewConfig({ ...env, DEVELOPMENT_DATABASE_URL: databaseUrl })
      .databaseUrl,
    databaseUrl,
  );
  assert.throws(() =>
    membershipPreviewConfig({
      ...env,
      DEVELOPMENT_DATABASE_URL: databaseUrl,
      DEVELOPMENT_PROJECT_REF: "fotdmeakexgrkronxlof",
    }),
  );
});
test("direct and session-pooler readers pin Development and pass secrets only in a minimal child environment", () => {
  for (const uri of [
    databaseUrl,
    `postgresql://postgres.${p.database}:fictional-password@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  ]) {
    let calls = 0;
    readMembershipDevelopmentCatalog(
      uri,
      process.cwd(),
      (file, args, options) => {
        calls++;
        assert.equal(file, "psql");
        assert.deepEqual(args, [
          "-X",
          "-w",
          "-q",
          "-t",
          "-A",
          "-v",
          "ON_ERROR_STOP=1",
        ]);
        assert.equal(options.input, developmentCatalogQuery(process.cwd()));
        assert.equal(options.env.PGPASSWORD, "fictional-password");
        assert.equal(options.env.PGDATABASE, "postgres");
        assert.equal(options.env.PGSSLMODE, "verify-full");
        assert.equal(
          options.env.PGSSLROOTCERT,
          resolve(
            process.cwd(),
            "scripts/hosted-development/membership-display-development-ca.pem",
          ),
        );
        assert.match(
          options.env.PGOPTIONS,
          /default_transaction_read_only=on/u,
        );
        assert.equal(options.timeout, 150000);
        assert.ok(!JSON.stringify(args).includes("fictional-password"));
        assert.deepEqual(
          Object.keys(options.env).sort(),
          [
            "PATH",
            "LANG",
            "PGHOST",
            "PGPORT",
            "PGDATABASE",
            "PGUSER",
            "PGPASSWORD",
            "PGSSLMODE",
            "PGSSLROOTCERT",
            "PGCONNECT_TIMEOUT",
            "PGOPTIONS",
          ].sort(),
        );
        return "t\n";
      },
    );
    assert.equal(calls, 1);
  }
});
test("an existing require or verify-ca URI is upgraded to hostname verification with the fixed reviewed CA", () => {
  for (const mode of ["require", "verify-ca", "verify-full"]) {
    readMembershipDevelopmentCatalog(
      databaseUrl + "?sslmode=" + mode,
      process.cwd(),
      (_file, _args, options) => {
        assert.equal(options.env.PGSSLMODE, "verify-full");
        assert.equal(
          options.env.PGSSLROOTCERT,
          resolve(
            process.cwd(),
            "scripts/hosted-development/membership-display-development-ca.pem",
          ),
        );
        return "t";
      },
    );
  }
});
for (const uri of [
  databaseUrl.replace(p.database, "fotdmeakexgrkronxlof"),
  databaseUrl.replace("db.", "untrusted."),
  databaseUrl.replace(/\/postgres$/u, "/other"),
  databaseUrl.replace(":5432", ":6543"),
  databaseUrl + "?sslmode=disable",
  databaseUrl + "?sslmode=allow",
  databaseUrl + "?sslmode=prefer",
  databaseUrl + "?sslrootcert=/tmp/unreviewed-ca.pem",
  databaseUrl + "?options=-c%20default_transaction_read_only=off",
  databaseUrl + "?sslmode=require&sslmode=disable",
  databaseUrl + "#other",
  `postgresql://postgres.fotdmeakexgrkronxlof:fictional-password@aws-0-us-west-1.pooler.supabase.com:5432/postgres`,
])
  test(
    "invalid Development connection refuses before child execution: " +
      uri.replace("fictional-password", "[redacted]"),
    () => {
      let calls = 0;
      assert.throws(() =>
        readMembershipDevelopmentCatalog(uri, process.cwd(), () => {
          calls++;
          return "t";
        }),
      );
      assert.equal(calls, 0);
    },
  );
test("false, malformed and failed catalog responses stay fatal with raw credential output suppressed", () => {
  for (const result of ["f", "t\nextra", "", "true"])
    assert.throws(() =>
      readMembershipDevelopmentCatalog(
        databaseUrl,
        process.cwd(),
        () => result,
      ),
    );
  assert.throws(
    () =>
      readMembershipDevelopmentCatalog(databaseUrl, process.cwd(), () => {
        throw new Error(databaseUrl);
      }),
    (error) => !error.message.includes("fictional-password"),
  );
});
test("only the three Development catalog steps receive the existing database URL", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/deploy-membership-display.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const [acceptance, production] = workflow.split("\n  deploy:\n");
  assert.equal(
    acceptance.match(
      /DEVELOPMENT_DATABASE_URL: \$\{\{ secrets\.DEVELOPMENT_DATABASE_URL \}\}/gu,
    )?.length,
    3,
  );
  assert.ok(!production.includes("DEVELOPMENT_DATABASE_URL"));
});

for (const [uri, code] of [
  [databaseUrl.replace(":5432", ":6543"), "database-port"],
  [databaseUrl.replace(p.database, "other-project"), "database-target"],
  [databaseUrl.replace("fictional-password", ""), "database-auth-input"],
  [databaseUrl.replace(/\/postgres$/u, "/other"), "database-name"],
  [databaseUrl + "?options=unreviewed", "database-options"],
  [databaseUrl + "?sslmode=disable", "database-tls-mode"],
])
  test("connection-shape refusal reports only " + code, () => {
    let calls = 0;
    assert.throws(
      () =>
        readMembershipDevelopmentCatalog(uri, process.cwd(), () => {
          calls++;
        }),
      (error) => {
        assert.equal(membershipPreviewDiagnosticCode(error), code);
        assert.ok(!error.message.includes("fictional-password"));
        return true;
      },
    );
    assert.equal(calls, 0);
  });
for (const [detail, code] of [
  [{ code: "ENOENT" }, "database-client"],
  [{ code: "ETIMEDOUT" }, "database-timeout"],
  [{ stderr: "certificate verify failed" }, "database-tls"],
  [{ stderr: "password authentication failed" }, "database-auth"],
  [{ stderr: "could not translate host name" }, "database-dns"],
  [{ stderr: "Network is unreachable" }, "database-network"],
  [{ status: 2 }, "database-connect"],
  [{ status: 3 }, "database-query"],
])
  test(
    "client failure reports " + code + " without credential or provider text",
    () => {
      const secret = "fictional-private-connection-value";
      assert.throws(
        () =>
          readMembershipDevelopmentCatalog(databaseUrl, process.cwd(), () => {
            throw Object.assign(new Error(secret), {
              ...detail,
              stderr: (detail.stderr ?? "") + " " + secret,
            });
          }),
        (error) => {
          assert.equal(membershipPreviewDiagnosticCode(error), code);
          assert.ok(!error.message.includes(secret));
          assert.ok(!JSON.stringify(error).includes(secret));
          return true;
        },
      );
    },
  );
test("CA, query-source and catalog failures remain distinct and fatal", () => {
  const refuses = (code) => (error) =>
    membershipPreviewDiagnosticCode(error) === code;
  assert.throws(
    () =>
      readCatalogImplementation(
        databaseUrl,
        process.cwd(),
        () => assert.fail("must not connect"),
        () => {
          throw Error("private CA path");
        },
      ),
    refuses("database-ca"),
  );
  assert.throws(
    () =>
      readMembershipDevelopmentCatalog(databaseUrl, "/unused", () =>
        assert.fail("must not connect"),
      ),
    refuses("database-query-source"),
  );
  assert.throws(
    () =>
      readMembershipDevelopmentCatalog(databaseUrl, process.cwd(), () => "f"),
    refuses("development-catalog-mismatch"),
  );
  assert.throws(
    () =>
      readMembershipDevelopmentCatalog(
        databaseUrl,
        process.cwd(),
        () => "unexpected",
      ),
    refuses("database-output"),
  );
  assert.equal(
    membershipPreviewDiagnosticCode(
      Object.assign(Error("private"), { code: "database-auth" }),
    ),
    "unclassified",
  );
});
test("load script retains every functional/performance threshold with only its target proof extended", () => {
  const source = readFileSync(
    new URL("./test-csf-load.mjs", import.meta.url),
    "utf8",
  );
  for (const text of [
    "mutationCount",
    "BROWSER_REVIEW_NAVIGATIONS = 25",
    "DEFAULT_DURATION_MS = 15 * 60 * 1000",
    "result.readP95Ms <= 2_500",
    "result.mutationP95Ms <= 3_000",
    "PRODUCTION_PROJECT_REF",
    "membershipAcceptanceOrigin(process.env)",
  ])
    assert.ok(source.includes(text), text);
});
test("acceptance keeps the existing fixed synthetic identities, fixture route and bounded preference operations", () => {
  const accounts = buildSyntheticAccounts();
  assert.equal(accounts.members.length, 90);
  assert.equal(accounts.officers.length, 10);
  assert.equal(
    new Set(
      [...accounts.members, ...accounts.officers].map((a) => a.authUserId),
    ).size,
    100,
  );
  for (const [role, pool] of [
    ["member", accounts.members],
    ["officer", accounts.officers],
  ])
    for (const account of pool) {
      assert.equal(account.role, role);
      assert.match(
        account.email,
        new RegExp("^" + role + "-[0-9]{3}@csf-load\\.local\\.test$", "u"),
      );
    }
  assert.equal(fixtureOrganizationPath(), "/organization/csf-load-fixture");
  assert.equal(FIXTURE_MARKER, "csf-hosted-load-fixture/v1");
  const load = readFileSync(
    new URL("./test-csf-load.mjs", import.meta.url),
    "utf8",
  );
  for (const text of [
    "email: account.email",
    "payload.sub.toLowerCase() !== expectedAccount.authUserId.toLowerCase()",
    "payload.app_metadata?.csf_hosted_load_fixture !== true",
    "payload.app_metadata?.organization_handle !== FIXTURE_ORGANIZATION_HANDLE",
    "payload.app_metadata?.fixture_contract !== FIXTURE_MARKER",
    "location.pathname !== fixtureOrganizationPath()",
    "const BROWSER_WARMUP_SAMPLES = 5",
    "const BROWSER_MEASURED_SAMPLES = 30",
    "if (await restoreOfficerButton.isVisible())",
  ])
    assert.ok(load.includes(text), text);
  assert.doesNotMatch(
    load,
    /auth\.admin\.|\.signUp\(|provision-csf|\.insert\(|\.upsert\(/u,
  );
});

function healthyStatus() {
  return {
    service: "lets-assist",
    status: "degraded",
    environment: "preview",
    version: config.sha,
    deep: true,
    checks: [
      { name: "environment", state: "pass", critical: true },
      { name: "database", state: "pass", critical: true },
      { name: "tables-deep", state: "pass", critical: false },
      {
        name: "workers",
        state: "warn",
        critical: false,
        details: {
          autoPublishHours: false,
          csfCommunications: false,
          csfImportCommit: false,
          csfPublicationNotifications: false,
          csfScheduledPostPublisher: false,
          csfWorkbookRefresh: false,
          organizationCalendarSync: false,
          organizationSheetSync: false,
          projectCancellationWorker: false,
          csfControlMode: "environment",
        },
      },
    ],
  };
}
test("only the all-disabled worker warning is accepted, with healthy environment/database/deep tables", () => {
  verifyMembershipPreviewStatus(healthyStatus(), config);
  for (const name of ["environment", "database", "tables-deep"])
    for (const state of ["warn", "fail"]) {
      const status = healthyStatus();
      status.checks.find((c) => c.name === name).state = state;
      assert.throws(() => verifyMembershipPreviewStatus(status, config));
    }
  for (const change of [
    { checks: [] },
    { checks: null },
    { status: "operational" },
    { status: "outage" },
    { environment: "production" },
    { version: "b".repeat(40) },
    { deep: false },
  ])
    assert.throws(() =>
      verifyMembershipPreviewStatus({ ...healthyStatus(), ...change }, config),
    );
  const duplicated = healthyStatus();
  duplicated.checks.push(duplicated.checks[0]);
  assert.throws(() => verifyMembershipPreviewStatus(duplicated, config));
});
for (const flag of Object.keys(healthyStatus().checks.at(-1).details))
  test("refuses missing or enabled Preview worker detail " + flag, () => {
    const status = healthyStatus();
    status.checks.at(-1).details[flag] =
      flag === "csfControlMode" ? "database" : true;
    assert.throws(() => verifyMembershipPreviewStatus(status, config));
    delete status.checks.at(-1).details[flag];
    assert.throws(() => verifyMembershipPreviewStatus(status, config));
  });

function providerFixture({
  loseCreate = false,
  moveAlias = false,
  wrongSha = false,
  baselineMove = false,
  unhealthy = false,
} = {}) {
  const calls = [],
    records = [];
  let creates = 0;
  const config = {
    sha: "a".repeat(40),
    run: "123",
    repository: p.repository,
    repositoryId: p.repositoryId,
    projectId: p.project,
    teamId: p.team,
    productionAppSha: p.productionApp,
    vercelToken: "fictional-provider-token",
    accessToken: "fictional-read-token",
    bypass: "fictional-bypass",
  };
  const json = (value) => new Response(JSON.stringify(value), { status: 200 });
  const fetcher = async (url, options = {}) => {
    const u = new URL(String(url)),
      method = options.method ?? "GET";
    calls.push({ path: u.pathname, method });
    if (u.hostname === "api.supabase.com") {
      assert.equal(
        u.pathname,
        "/v1/projects/" + p.database + "/database/query/read-only",
      );
      assert.equal(method, "POST");
      assert.match(JSON.parse(options.body).query, /READ ONLY/u);
      return json([{ valid: true }]);
    }
    if (u.hostname === "fictional-preview.vercel.app") {
      const status = healthyStatus();
      if (unhealthy)
        status.checks.find((c) => c.name === "database").state = "fail";
      return json(status);
    }
    assert.equal(u.hostname, "api.vercel.com");
    if (u.pathname === "/v4/aliases")
      return json({
        aliases: [
          {
            alias: "lets-assist.com",
            projectId: p.project,
            deploymentId:
              baselineMove || (moveAlias && creates)
                ? "dpl_Other"
                : "dpl_Prior",
          },
        ],
      });
    if (
      u.pathname === "/v13/deployments/dpl_Prior" ||
      u.pathname === "/v13/deployments/dpl_Other"
    )
      return json({
        id: u.pathname.split("/").at(-1),
        projectId: p.project,
        target: "production",
        readyState: "READY",
        meta: {
          githubCommitSha: wrongSha ? "b".repeat(40) : p.productionApp,
          githubOrg: "riddhimanrana",
          githubRepo: "lets-assist",
        },
        gitSource: {
          sha: wrongSha ? "b".repeat(40) : p.productionApp,
          repoId: p.repositoryId,
        },
      });
    if (u.pathname === "/v4/aliases/dev.lets-assist.com")
      return json({ projectId: p.project, deploymentId: "dpl_Development" });
    if (u.pathname === "/v13/deployments/dpl_Development")
      return json({
        projectId: p.project,
        target: null,
        meta: { githubCommitSha: p.development },
      });
    if (u.pathname === "/v9/projects/" + p.project)
      return json({
        id: p.project,
        accountId: p.team,
        link: { repoId: p.repositoryId, productionBranch: "main" },
      });
    if (u.pathname === "/v13/deployments" && method === "POST") {
      creates++;
      assert.equal(JSON.parse(options.body).autoAssignCustomDomains, false);
      if (loseCreate) throw new Error("fictional lost response");
      return json(deployment());
    }
    if (u.pathname === "/v13/deployments/dpl_Fictional")
      return json({ ...deployment(), readyState: "READY" });
    assert.fail("Unexpected provider operation: " + method + " " + u.pathname);
  };
  return {
    config,
    calls,
    records,
    fetcher,
    record: (value) => records.push(value),
    creates: () => creates,
  };
}
test("the protected URL preserves the full catalog proof before creation and after READY", async () => {
  const v = providerFixture();
  v.config.accessToken = "";
  v.config.databaseUrl = databaseUrl;
  let reads = 0;
  const receipt = await createMembershipPreview(v.config, {
    ...v,
    verifyCa: reviewedCa,
    execute: (_file, _args, options) => {
      reads++;
      assert.equal(options.input, developmentCatalogQuery(process.cwd()));
      return "t";
    },
  });
  assert.equal(receipt.readiness, "READY");
  assert.equal(v.creates(), 1);
  assert.equal(reads, 2);
  assert.ok(!v.calls.some((c) => c.path.endsWith("/database/query/read-only")));
});
test("fixed phase observations distinguish preflight from the single create boundary", async () => {
  const v = providerFixture(),
    phases = [];
  await createMembershipPreview(v.config, {
    ...v,
    onPhase: (phase) => phases.push(phase),
  });
  assert.deepEqual(phases, [
    "development-catalog",
    "vercel-aliases",
    "vercel-project",
    "preview-create",
    "preview-receipt",
    "preview-readiness",
    "preview-postcheck",
  ]);
  assert.equal(v.creates(), 1);
  const refused = providerFixture(),
    stopped = [];
  refused.config.accessToken = "";
  refused.config.databaseUrl = databaseUrl.replace(":5432", ":6543");
  await assert.rejects(
    createMembershipPreview(refused.config, {
      ...refused,
      onPhase: (phase) => stopped.push(phase),
    }),
    (error) => membershipPreviewDiagnosticCode(error) === "database-port",
  );
  assert.deepEqual(stopped, ["development-catalog"]);
  assert.equal(refused.calls.length, 0);
  assert.equal(refused.creates(), 0);
});
test("a failed URL catalog proof performs no provider operation or create", async () => {
  const v = providerFixture();
  v.config.accessToken = "";
  v.config.databaseUrl = databaseUrl;
  await assert.rejects(
    createMembershipPreview(v.config, {
      ...v,
      verifyCa: reviewedCa,
      execute: () => "f",
    }),
  );
  assert.equal(v.creates(), 0);
  assert.deepEqual(v.calls, []);
  assert.deepEqual(v.records, []);
});
test("a denied existing Management API read never falls through to the URL transport", async () => {
  const v = providerFixture();
  v.config.databaseUrl = databaseUrl;
  let childCalls = 0;
  await assert.rejects(
    createMembershipPreview(v.config, {
      ...v,
      fetcher: async () => new Response("", { status: 403 }),
      execute: () => {
        childCalls++;
        return "t";
      },
    }),
  );
  assert.equal(childCalls, 0);
  assert.equal(v.creates(), 0);
});
test("real Preview orchestration creates once, records before waiting and never writes aliases", async () => {
  const v = providerFixture();
  const receipt = await createMembershipPreview(v.config, v);
  assert.equal(v.creates(), 1);
  assert.equal(receipt.readiness, "READY");
  assert.deepEqual(
    v.records.map((r) => r.readiness),
    ["pending", "READY"],
  );
  assert.equal(
    v.calls.filter(
      (c) => c.method === "POST" && c.path.startsWith("/v4/aliases"),
    ).length,
    0,
  );
  assert.ok(
    v.calls.every(
      (c) =>
        c.method === "GET" ||
        c.path === "/v13/deployments" ||
        c.path.endsWith("/database/query/read-only"),
    ),
  );
});
test("unknown create outcome is never retried and cannot produce a ready receipt", async () => {
  const v = providerFixture({ loseCreate: true });
  await assert.rejects(createMembershipPreview(v.config, v), /unproved/u);
  assert.equal(v.creates(), 1);
  assert.deepEqual(v.records, []);
});
test("a moved shared alias refuses acceptance after creation without overwriting it", async () => {
  const v = providerFixture({ moveAlias: true });
  await assert.rejects(createMembershipPreview(v.config, v), /refused/u);
  assert.equal(v.creates(), 1);
  assert.ok(
    v.calls.every(
      (c) =>
        c.method !== "POST" ||
        c.path === "/v13/deployments" ||
        c.path.endsWith("/database/query/read-only"),
    ),
  );
});
test("each Production baseline check requires both the pinned app SHA and the hosted receipt's exact deployment", async () => {
  const v = providerFixture();
  assert.equal(
    await checkMembershipProductionBaseline(v.config, receipt(), v.fetcher),
    "dpl_Prior",
  );
  const moved = providerFixture({ baselineMove: true });
  await assert.rejects(
    checkMembershipProductionBaseline(moved.config, receipt(), moved.fetcher),
  );
  const wrong = providerFixture({ wrongSha: true });
  await assert.rejects(
    checkMembershipProductionBaseline(wrong.config, receipt(), wrong.fetcher),
  );
  assert.ok(
    [...v.calls, ...moved.calls, ...wrong.calls].every(
      (c) => c.method === "GET",
    ),
  );
});
test("unhealthy Preview refuses actual orchestration without retry or alias writes", async () => {
  const v = providerFixture({ unhealthy: true });
  await assert.rejects(createMembershipPreview(v.config, v));
  assert.equal(v.creates(), 1);
  assert.ok(
    v.calls.every(
      (c) =>
        c.method !== "POST" ||
        c.path === "/v13/deployments" ||
        c.path.endsWith("/database/query/read-only"),
    ),
  );
});
test("a fresh check after a hypothetical review wait refuses a moved baseline", async () => {
  const v = providerFixture({ baselineMove: true });
  await assert.rejects(checkMembershipPreview(v.config, receipt(), v));
  assert.equal(v.creates(), 0);
});
