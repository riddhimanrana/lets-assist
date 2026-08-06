import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("server-only", () => ({}));

/**
 * The shared cron auth/shape probe, and the five routes that call it, driven
 * with no database, no provider, no Storage, and no network.
 *
 * The assertions that matter most are the negative ones. Every danger boundary
 * a cron route can cross is mocked with a counter, so "the probe returned before
 * dispatch" is a number this file can check rather than a claim it has to trust.
 * A route that regressed to dispatching first would still return the right JSON
 * — and would still fail here, because the counter would not be zero.
 */

// ---------------------------------------------------------------------------
// Danger boundaries. Each one records rather than no-ops: a silent stub cannot
// tell "the route never called this" apart from "the route called it and the
// stub swallowed it".
// ---------------------------------------------------------------------------

const createClientCalls: unknown[] = [];
const sendEmailCalls: unknown[] = [];
const adminClientCalls: string[] = [];
const dataExportCalls: unknown[] = [];
const calendarSyncCalls: unknown[] = [];
const sheetsWriteCalls: unknown[] = [];
const googleTokenCalls: unknown[] = [];
const googleAuthCalls: unknown[] = [];
const reportRowCalls: unknown[] = [];

function dangerCallTotals() {
  return {
    createClient: createClientCalls.length,
    sendEmail: sendEmailCalls.length,
    getAdminClient: adminClientCalls.length,
    processPendingDataExportJobs: dataExportCalls.length,
    syncOrganizationCalendarInternal: calendarSyncCalls.length,
    replaceSpreadsheetReportValues: sheetsWriteCalls.length,
    googleAccessToken: googleTokenCalls.length,
    googleOAuthAuthorization: googleAuthCalls.length,
    organizationReportRows: reportRowCalls.length,
  };
}

const ZERO_DANGER_CALLS = {
  createClient: 0,
  sendEmail: 0,
  getAdminClient: 0,
  processPendingDataExportJobs: 0,
  syncOrganizationCalendarInternal: 0,
  replaceSpreadsheetReportValues: 0,
  googleAccessToken: 0,
  googleOAuthAuthorization: 0,
  organizationReportRows: 0,
};

// `processExpiredSessions()` and `processPendingJobs()` are module-local, so
// they are proven inert through the boundary each one crosses first: neither can
// do anything without a Supabase client.
mock.module("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    createClientCalls.push(args);
    throw new Error(
      "processExpiredSessions() must not construct a Supabase client under the probe",
    );
  },
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    adminClientCalls.push(new Error().stack ?? "");
    throw new Error("getAdminClient() must not be reached under the probe");
  },
}));

mock.module("@/services/email", () => ({
  sendEmail: async (payload: unknown) => {
    sendEmailCalls.push(payload);
    throw new Error("sendEmail() must not be reached under the probe");
  },
}));

mock.module("@/lib/supabase/data-export-jobs", () => ({
  processPendingDataExportJobs: async (limit: unknown) => {
    dataExportCalls.push(limit);
    throw new Error(
      "processPendingDataExportJobs() must not be reached under the probe",
    );
  },
}));

mock.module("@/lib/organization/calendar-sync", () => ({
  syncOrganizationCalendarInternal: async (organizationId: unknown) => {
    calendarSyncCalls.push(organizationId);
    throw new Error(
      "syncOrganizationCalendarInternal() must not be reached under the probe",
    );
  },
}));

mock.module("@/services/google-sheets", () => ({
  replaceSpreadsheetReportValues: async (...args: unknown[]) => {
    sheetsWriteCalls.push(args);
    throw new Error(
      "replaceSpreadsheetReportValues() must not be reached under the probe",
    );
  },
}));

mock.module("@/services/calendar", () => ({
  getGoogleAccessTokenForSheetsForUser: async (...args: unknown[]) => {
    googleTokenCalls.push(args);
    throw new Error("Google access tokens must not be minted under the probe");
  },
  organizationSheetsGoogleBinding: (organizationId: unknown) => ({
    organizationId,
  }),
}));

mock.module("@/lib/auth/google-oauth-authorization", () => ({
  authorizeGoogleOAuthOrganizationRequest: async (...args: unknown[]) => {
    googleAuthCalls.push(args);
    throw new Error(
      "Google OAuth authorization must not be reached under the probe",
    );
  },
}));

mock.module("@/lib/organization/report-service", () => ({
  buildOrganizationReportRowsForSync: async (...args: unknown[]) => {
    reportRowCalls.push(args);
    throw new Error(
      "Organization report rows must not be built under the probe",
    );
  },
}));

mock.module("@/emails/certificate-published", () => ({ default: () => null }));
mock.module("@/emails/project-cancellation", () => ({ default: () => null }));

// ---------------------------------------------------------------------------
// Isolated-identity fixtures
// ---------------------------------------------------------------------------

const temporaryDirectories: string[] = [];

const BASE_PORT = 55320;
const PORT_OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, 9];

// The probe now consumes the same strict validator every other isolated path
// uses, so its fixtures have to be complete stacks — marker *and* generated
// config — rather than the marker subset the old local parser was satisfied by.
const DISABLED_GOOGLE_AUTH_LINES = [
  "[auth.external.google]",
  "enabled = false",
  'client_id = ""',
  'secret = ""',
  'redirect_uri = ""',
  "skip_nonce_check = false",
];

function createIsolatedWorkDir(
  options: {
    projectId?: string;
    state?: string;
    databaseVolume?: string;
    workDirLine?: string;
    markerMode?: number;
    omitMarker?: boolean;
    omitConfig?: boolean;
    configProjectId?: string;
    ports?: number[];
    googleAuthLines?: string[];
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "csf-probe-identity-"));
  temporaryDirectories.push(directory);
  const projectId = options.projectId ?? "lets-assist-csf-browser-probe-test";

  if (!options.omitMarker) {
    const marker = [
      `state=${options.state ?? "ready"}`,
      `project_id=${projectId}`,
      `base_port=${BASE_PORT}`,
      `work_dir=${options.workDirLine ?? directory}`,
      ...(options.state === "starting"
        ? []
        : [
            `db_volume=${options.databaseVolume ?? `supabase_db_${projectId}`}`,
            `db_volume_project_label=${projectId}`,
          ]),
      "",
    ].join("\n");
    const markerPath = join(directory, ".lets-assist-csf-isolated-stack");
    writeFileSync(markerPath, marker);
    chmodSync(markerPath, options.markerMode ?? 0o600);
  }

  if (!options.omitConfig) {
    mkdirSync(join(directory, "supabase"), { mode: 0o700 });
    const [
      shadow,
      api,
      database,
      studio,
      inbucket,
      smtp,
      inspector,
      analytics,
      pooler,
    ] = options.ports ?? PORT_OFFSETS.map((offset) => BASE_PORT + offset);
    const configPath = join(directory, "supabase", "config.toml");
    writeFileSync(
      configPath,
      [
        `project_id = "${options.configProjectId ?? projectId}"`,
        "[api]",
        `port = ${api}`,
        "[db]",
        `port = ${database}`,
        `shadow_port = ${shadow}`,
        "[db.pooler]",
        `port = ${pooler}`,
        "[studio]",
        `port = ${studio}`,
        "[local_smtp]",
        `port = ${inbucket}`,
        `smtp_port = ${smtp}`,
        "[edge_runtime]",
        `inspector_port = ${inspector}`,
        "[analytics]",
        `port = ${analytics}`,
        ...(options.googleAuthLines ?? DISABLED_GOOGLE_AUTH_LINES),
        "[auth.external.apple]",
        "enabled = false",
        "",
      ].join("\n"),
    );
    chmodSync(configPath, 0o600);
  }

  return directory;
}

const VALID_WORK_DIR = createIsolatedWorkDir();

const ISOLATED_RUNTIME_ENV = {
  CSF_ISOLATED_WORK_DIR: VALID_WORK_DIR,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  SITE_URL: "http://localhost:3000",
};
const ORIGINAL_RUNTIME_ENV = Object.fromEntries(
  [...Object.keys(ISOLATED_RUNTIME_ENV)].map((key) => [key, process.env[key]]),
);

const CRON_SECRET = "probe-test-synthetic-secret";

// Read at module load by the calendar and sheet-sync routes, so it has to be in
// place before the first dynamic import below.
const LOAD_TIME_ENV: Record<string, string> = {
  CRON_TOKEN: CRON_SECRET,
  CRON_SECRET,
  AUTO_PUBLISH_SECRET_TOKEN: CRON_SECRET,
  PROJECT_CANCELLATION_WORKER_SECRET_TOKEN: CRON_SECRET,
  ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN: CRON_SECRET,
  ORG_SHEET_SYNC_WORKER_SECRET_TOKEN: CRON_SECRET,
  // Deliberately enabled: a route that only looked safe because its worker was
  // switched off would prove nothing about the probe.
  AUTO_PUBLISH_ENABLED: "true",
  PROJECT_CANCELLATION_WORKER_ENABLED: "true",
  ORG_SHEET_SYNC_WORKER_ENABLED: "true",
};
for (const [key, value] of Object.entries(LOAD_TIME_ENV))
  process.env[key] = value;
for (const [key, value] of Object.entries(ISOLATED_RUNTIME_ENV))
  process.env[key] = value;

const { NextRequest } = await import("next/server");
const {
  cronAuthShapeProbe,
  CRON_AUTH_SHAPE_PROBE_ENV,
  CRON_AUTH_SHAPE_PROBE_HEADER,
  CRON_AUTH_SHAPE_PROBE_MODE,
  CRON_PROBE_ROUTE_IDS,
} = await import("@/lib/cron/auth-shape-probe");

const routeModules = {
  "auto-publish-hours": await import("@/app/api/cron/auto-publish-hours/route"),
  "project-cancellations":
    await import("@/app/api/cron/project-cancellations/route"),
  "organization-calendar-sync":
    await import("@/app/api/cron/organization-calendar-sync/route"),
  "organization-sheet-sync":
    await import("@/app/api/cron/organization-sheet-sync/route"),
  "data-exports": await import("@/app/api/cron/data-exports/route"),
} as const;

const ROUTE_PATHS = {
  "auto-publish-hours": "/api/cron/auto-publish-hours",
  "project-cancellations": "/api/cron/project-cancellations",
  "organization-calendar-sync": "/api/cron/organization-calendar-sync",
  "organization-sheet-sync": "/api/cron/organization-sheet-sync",
  "data-exports": "/api/cron/data-exports",
} as const;

type RouteId = keyof typeof routeModules;

function makeRequest(
  routeId: RouteId,
  method: "GET" | "POST",
  headers: Record<string, string> = {},
) {
  return new NextRequest(`http://127.0.0.1:3009${ROUTE_PATHS[routeId]}`, {
    method,
    headers,
  });
}

function resetCounters() {
  for (const list of [
    createClientCalls,
    sendEmailCalls,
    adminClientCalls,
    dataExportCalls,
    calendarSyncCalls,
    sheetsWriteCalls,
    googleTokenCalls,
    googleAuthCalls,
    reportRowCalls,
  ]) {
    list.length = 0;
  }
}

beforeEach(() => {
  resetCounters();
  for (const [key, value] of Object.entries(ISOLATED_RUNTIME_ENV))
    process.env[key] = value;
  delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;
  for (const [key, value] of Object.entries(ORIGINAL_RUNTIME_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function probeEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ...ISOLATED_RUNTIME_ENV,
    CRON_AUTH_SHAPE_PROBE_ONLY: CRON_AUTH_SHAPE_PROBE_MODE,
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return env as NodeJS.ProcessEnv;
}

const headersWith = (values: Record<string, string>) => ({
  headers: { get: (name: string) => values[name.toLowerCase()] ?? null },
});

const EXACT_PROBE_HEADERS = headersWith({
  [CRON_AUTH_SHAPE_PROBE_HEADER]: CRON_AUTH_SHAPE_PROBE_MODE,
});

// ---------------------------------------------------------------------------
// Helper contract
// ---------------------------------------------------------------------------

describe("cron auth/shape probe helper contract", () => {
  test("exposes exactly the five stable route IDs", () => {
    expect([...CRON_PROBE_ROUTE_IDS]).toEqual([
      "auto-publish-hours",
      "project-cancellations",
      "organization-calendar-sync",
      "organization-sheet-sync",
      "data-exports",
    ]);
    expect(CRON_AUTH_SHAPE_PROBE_ENV).toBe("CRON_AUTH_SHAPE_PROBE_ONLY");
    expect(CRON_AUTH_SHAPE_PROBE_MODE).toBe("auth-shape-v1");
    expect(CRON_AUTH_SHAPE_PROBE_HEADER).toBe("x-lets-assist-cron-probe");
  });

  test("returns null when probe mode is unset or empty, leaving normal behavior unchanged", () => {
    for (const routeId of CRON_PROBE_ROUTE_IDS) {
      expect(
        cronAuthShapeProbe(
          routeId,
          EXACT_PROBE_HEADERS,
          probeEnv({
            CRON_AUTH_SHAPE_PROBE_ONLY: undefined,
          }),
        ),
      ).toBeNull();
      expect(
        cronAuthShapeProbe(
          routeId,
          EXACT_PROBE_HEADERS,
          probeEnv({
            CRON_AUTH_SHAPE_PROBE_ONLY: "",
          }),
        ),
      ).toBeNull();
    }
  });

  test("an authenticated exact probe returns 200 with the exact auth-shape-v1 body", async () => {
    for (const routeId of CRON_PROBE_ROUTE_IDS) {
      const response = cronAuthShapeProbe(
        routeId,
        EXACT_PROBE_HEADERS,
        probeEnv(),
      );
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response!.text()).toBe(
        `{"ok":true,"route":"${routeId}","mode":"auth-shape-v1","dispatched":false}`,
      );
    }
  });

  test("an absent or wrong probe header fails closed with 428 and the exact body", async () => {
    for (const routeId of CRON_PROBE_ROUTE_IDS) {
      for (const request of [
        headersWith({}),
        headersWith({ [CRON_AUTH_SHAPE_PROBE_HEADER]: "auth-shape-v0" }),
        headersWith({ [CRON_AUTH_SHAPE_PROBE_HEADER]: "AUTH-SHAPE-V1" }),
        headersWith({ [CRON_AUTH_SHAPE_PROBE_HEADER]: " auth-shape-v1" }),
      ]) {
        const response = cronAuthShapeProbe(routeId, request, probeEnv());
        expect(response!.status).toBe(428);
        expect(await response!.text()).toBe(
          `{"ok":false,"route":"${routeId}","mode":"auth-shape-v1","error":"cron_probe_required","dispatched":false}`,
        );
      }
    }
  });

  test("a misspelled probe env value fails closed rather than falling through to dispatch", async () => {
    for (const wrongValue of [
      "auth-shape-v2",
      "auth_shape_v1",
      "AUTH-SHAPE-V1",
      "1",
      "true",
    ]) {
      const response = cronAuthShapeProbe(
        "data-exports",
        EXACT_PROBE_HEADERS,
        probeEnv({ CRON_AUTH_SHAPE_PROBE_ONLY: wrongValue }),
      );
      expect(response).not.toBeNull();
      expect(response!.status).toBe(503);
      expect(await response!.text()).toBe(
        '{"ok":false,"route":"data-exports","mode":"auth-shape-v1","error":"cron_probe_isolation_invalid","dispatched":false}',
      );
    }
  });

  test("probe mode without a validated isolated identity returns exactly 503", async () => {
    const invalidIdentities: Array<
      [string, Record<string, string | undefined>]
    > = [
      ["absent work dir", { CSF_ISOLATED_WORK_DIR: undefined }],
      ["relative work dir", { CSF_ISOLATED_WORK_DIR: "relative/path" }],
      [
        "nonexistent work dir",
        { CSF_ISOLATED_WORK_DIR: "/nonexistent/csf-probe" },
      ],
      [
        "no marker",
        { CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({ omitMarker: true }) },
      ],
      [
        "transitional marker",
        { CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({ state: "starting" }) },
      ],
      [
        "non-isolated project id",
        {
          CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({
            projectId: "lets-assist",
          }),
        },
      ],
      [
        "mismatched database volume",
        {
          CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({
            databaseVolume: "supabase_db_other",
          }),
        },
      ],
      [
        "marker describing another directory",
        {
          CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({
            workDirLine: tmpdir(),
          }),
        },
      ],
      [
        "group-readable marker",
        { CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({ markerMode: 0o644 }) },
      ],
      // Everything below this line is reachable only because the probe now
      // consumes the shared strict validator. The old local marker parser never
      // opened the generated config at all, so a stack whose config disagreed
      // with its marker — or whose Google provider had been switched back on —
      // answered 200.
      [
        "no generated config",
        { CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({ omitConfig: true }) },
      ],
      [
        "config project drift",
        {
          CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({
            configProjectId: "lets-assist-csf-browser-someone-else",
          }),
        },
      ],
      [
        "config port drift",
        {
          CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({
            ports: PORT_OFFSETS.map((offset, index) =>
              index === 1 ? 59999 : BASE_PORT + offset,
            ),
          }),
        },
      ],
      [
        "re-enabled Google identity provider",
        {
          CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir({
            googleAuthLines: [
              "[auth.external.google]",
              "enabled = true",
              'client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"',
              'secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"',
              'redirect_uri = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI)"',
              "skip_nonce_check = true",
            ],
          }),
        },
      ],
      [
        "duplicate marker field",
        {
          CSF_ISOLATED_WORK_DIR: (() => {
            const directory = createIsolatedWorkDir();
            const markerPath = join(
              directory,
              ".lets-assist-csf-isolated-stack",
            );
            writeFileSync(
              markerPath,
              `${readFileSync(markerPath, "utf8")}state=ready\n`,
            );
            chmodSync(markerPath, 0o600);
            return directory;
          })(),
        },
      ],
      [
        "truncated marker",
        {
          CSF_ISOLATED_WORK_DIR: (() => {
            const directory = createIsolatedWorkDir();
            const markerPath = join(
              directory,
              ".lets-assist-csf-isolated-stack",
            );
            writeFileSync(
              markerPath,
              readFileSync(markerPath, "utf8").replace(/\n$/u, ""),
            );
            chmodSync(markerPath, 0o600);
            return directory;
          })(),
        },
      ],
      [
        "hardlinked marker",
        {
          CSF_ISOLATED_WORK_DIR: (() => {
            const directory = createIsolatedWorkDir();
            linkSync(
              join(directory, ".lets-assist-csf-isolated-stack"),
              join(directory, "marker-second-name"),
            );
            return directory;
          })(),
        },
      ],
      ["hosted runtime marker VERCEL", { VERCEL: "1" }],
      ["hosted runtime marker VERCEL_ENV", { VERCEL_ENV: "production" }],
      [
        "hosted supabase url",
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co",
        },
      ],
      [
        "hosted site url",
        {
          NEXT_PUBLIC_SITE_URL: "https://lets-assist.com",
          SITE_URL: "https://lets-assist.com",
        },
      ],
    ];

    for (const [label, overrides] of invalidIdentities) {
      const response = cronAuthShapeProbe(
        "auto-publish-hours",
        EXACT_PROBE_HEADERS,
        probeEnv(overrides),
      );
      expect(response, label).not.toBeNull();
      expect(response!.status, label).toBe(503);
      expect(await response!.text()).toBe(
        '{"ok":false,"route":"auto-publish-hours","mode":"auth-shape-v1","error":"cron_probe_isolation_invalid","dispatched":false}',
      );
    }
  });

  test("isolation is re-read per call, so revoked evidence stops answering 200", async () => {
    const workDir = createIsolatedWorkDir();
    const env = probeEnv({ CSF_ISOLATED_WORK_DIR: workDir });

    expect(
      cronAuthShapeProbe("data-exports", EXACT_PROBE_HEADERS, env)!.status,
    ).toBe(200);
    rmSync(join(workDir, ".lets-assist-csf-isolated-stack"), { force: true });
    expect(
      cronAuthShapeProbe("data-exports", EXACT_PROBE_HEADERS, env)!.status,
    ).toBe(503);
  });

  test("revoked generated-config evidence is observed on the next call too", async () => {
    const workDir = createIsolatedWorkDir();
    const env = probeEnv({ CSF_ISOLATED_WORK_DIR: workDir });

    expect(
      cronAuthShapeProbe("data-exports", EXACT_PROBE_HEADERS, env)!.status,
    ).toBe(200);
    // The marker is untouched; only the generated config changes. A probe that
    // still validated the marker alone would keep answering 200 here.
    rmSync(join(workDir, "supabase", "config.toml"), { force: true });
    expect(
      cronAuthShapeProbe("data-exports", EXACT_PROBE_HEADERS, env)!.status,
    ).toBe(503);
  });

  test("probe mode is detected before any filesystem validation", async () => {
    // One environment, two outcomes, and the difference is the whole claim.
    //
    // The work directory does not exist, so if the strict validator ran it would
    // throw and the probe would fail closed with 503. Returning `null` for the
    // same environment is only possible if the mode check short-circuited first,
    // before a single stat — which is exactly what a production request must do.
    const missingWorkDir = "/nonexistent/csf-probe-must-not-stat-this";

    for (const routeId of CRON_PROBE_ROUTE_IDS) {
      expect(
        cronAuthShapeProbe(
          routeId,
          EXACT_PROBE_HEADERS,
          probeEnv({
            CRON_AUTH_SHAPE_PROBE_ONLY: undefined,
            CSF_ISOLATED_WORK_DIR: missingWorkDir,
          }),
        ),
        routeId,
      ).toBeNull();
    }

    expect(
      cronAuthShapeProbe(
        "data-exports",
        EXACT_PROBE_HEADERS,
        probeEnv({ CSF_ISOLATED_WORK_DIR: missingWorkDir }),
      )!.status,
    ).toBe(503);
  });

  test("the production probe source loads the one local validator without statically tracing the harness", () => {
    const probeSource = readFileSync(
      new URL("../../lib/cron/auth-shape-probe.ts", import.meta.url),
      "utf8",
    );
    // The looser copy is gone, not merely unused: two validators of the same
    // evidence is one too many, and the weaker one decides.
    expect(probeSource).toContain("inspectCsfIsolatedWorkDir");
    expect(probeSource).toContain("/* turbopackIgnore: true */ process.cwd()");
    expect(probeSource).not.toContain(
      'from "@/scripts/local-dev/dv-local-env.mjs"',
    );
    expect(probeSource).not.toContain("CSF_MARKER_LINE_PATTERN");
    expect(probeSource).not.toContain(".lets-assist-csf-isolated-stack");
    expect(probeSource).not.toContain("readFileSync");
    expect(probeSource).not.toContain("lstatSync");
  });
});

// ---------------------------------------------------------------------------
// Route wiring: authentication is unchanged, and nothing dispatches.
// ---------------------------------------------------------------------------

describe("cron routes fail closed under the probe without dispatching", () => {
  const routeIds = Object.keys(routeModules) as RouteId[];

  test("a missing or wrong bearer still takes the route's real 401 path", async () => {
    process.env.CRON_AUTH_SHAPE_PROBE_ONLY = CRON_AUTH_SHAPE_PROBE_MODE;

    for (const routeId of routeIds) {
      for (const method of ["GET", "POST"] as const) {
        const handler = routeModules[routeId][method];
        const noAuth = await handler(makeRequest(routeId, method));
        expect(noAuth.status, `${method} ${routeId} without auth`).toBe(401);

        const wrongAuth = await handler(
          makeRequest(routeId, method, {
            authorization: "Bearer wrong-secret",
          }),
        );
        expect(
          wrongAuth.status,
          `${method} ${routeId} with a wrong bearer`,
        ).toBe(401);
      }
    }

    expect(dangerCallTotals()).toEqual(ZERO_DANGER_CALLS);
  });

  test("an authenticated exact probe returns 200 and dispatches nothing", async () => {
    process.env.CRON_AUTH_SHAPE_PROBE_ONLY = CRON_AUTH_SHAPE_PROBE_MODE;

    for (const routeId of routeIds) {
      for (const method of ["GET", "POST"] as const) {
        const response = await routeModules[routeId][method](
          makeRequest(routeId, method, {
            authorization: `Bearer ${CRON_SECRET}`,
            [CRON_AUTH_SHAPE_PROBE_HEADER]: CRON_AUTH_SHAPE_PROBE_MODE,
          }),
        );
        expect(response.status, `${method} ${routeId}`).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
        expect(await response.text()).toBe(
          `{"ok":true,"route":"${routeId}","mode":"auth-shape-v1","dispatched":false}`,
        );
      }
    }

    expect(dangerCallTotals()).toEqual(ZERO_DANGER_CALLS);
  });

  test("an authenticated call without the probe header returns 428 and dispatches nothing", async () => {
    process.env.CRON_AUTH_SHAPE_PROBE_ONLY = CRON_AUTH_SHAPE_PROBE_MODE;

    for (const routeId of routeIds) {
      for (const method of ["GET", "POST"] as const) {
        const response = await routeModules[routeId][method](
          makeRequest(routeId, method, {
            authorization: `Bearer ${CRON_SECRET}`,
          }),
        );
        expect(response.status, `${method} ${routeId}`).toBe(428);
        expect(await response.text()).toBe(
          `{"ok":false,"route":"${routeId}","mode":"auth-shape-v1","error":"cron_probe_required","dispatched":false}`,
        );
      }
    }

    expect(dangerCallTotals()).toEqual(ZERO_DANGER_CALLS);
  });

  test("an authenticated call with an invalid isolated identity returns 503 and dispatches nothing", async () => {
    process.env.CRON_AUTH_SHAPE_PROBE_ONLY = CRON_AUTH_SHAPE_PROBE_MODE;
    process.env.CSF_ISOLATED_WORK_DIR = createIsolatedWorkDir({
      omitMarker: true,
    });

    for (const routeId of routeIds) {
      for (const method of ["GET", "POST"] as const) {
        const response = await routeModules[routeId][method](
          makeRequest(routeId, method, {
            authorization: `Bearer ${CRON_SECRET}`,
            [CRON_AUTH_SHAPE_PROBE_HEADER]: CRON_AUTH_SHAPE_PROBE_MODE,
          }),
        );
        expect(response.status, `${method} ${routeId}`).toBe(503);
        expect(await response.text()).toBe(
          `{"ok":false,"route":"${routeId}","mode":"auth-shape-v1","error":"cron_probe_isolation_invalid","dispatched":false}`,
        );
      }
    }

    expect(dangerCallTotals()).toEqual(ZERO_DANGER_CALLS);
  });

  test("the auto-publish status path is probed too, so no authenticated path escapes", async () => {
    process.env.CRON_AUTH_SHAPE_PROBE_ONLY = CRON_AUTH_SHAPE_PROBE_MODE;

    for (const routeId of [
      "auto-publish-hours",
      "project-cancellations",
    ] as const) {
      const request = new NextRequest(
        `http://127.0.0.1:3009${ROUTE_PATHS[routeId]}?status=1`,
        { method: "GET", headers: { authorization: `Bearer ${CRON_SECRET}` } },
      );
      const response = await routeModules[routeId].GET(request);
      expect(response.status, `${routeId}?status=1`).toBe(428);
    }

    expect(dangerCallTotals()).toEqual(ZERO_DANGER_CALLS);
  });

  test("with probe mode unset the routes reach their real dispatch boundary", async () => {
    // The mirror image of every test above: this is what proves the probe is a
    // real gate rather than a permanently-closed door. Each mocked boundary
    // throws, so a 500 here means the route genuinely tried to dispatch.
    delete process.env.CRON_AUTH_SHAPE_PROBE_ONLY;

    const dispatched = await routeModules["data-exports"].POST(
      makeRequest("data-exports", "POST", {
        authorization: `Bearer ${CRON_SECRET}`,
      }),
    );
    expect(dispatched.status).toBe(500);
    expect(dataExportCalls.length).toBe(1);

    resetCounters();

    const cancellations = await routeModules["project-cancellations"].POST(
      makeRequest("project-cancellations", "POST", {
        authorization: `Bearer ${CRON_SECRET}`,
      }),
    );
    expect(cancellations.status).toBe(500);
    expect(adminClientCalls.length).toBe(1);
  });
});
