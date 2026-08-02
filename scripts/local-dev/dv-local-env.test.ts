import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  link,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertProvidedLocalSupabaseEnvMatchesStatus,
  CSF_PROJECT_LABEL_KEY,
  assertLocalPostgresUrl,
  assertLocalSupabaseUrl,
  commitCsfIsolatedAppEnvironment,
  commitCsfIsolatedStack,
  CSF_DISABLED_GOOGLE_AUTH_BLOCK,
  CSF_ISOLATED_APP_PORT,
  CSF_STACK_HANDOFF_KEYS,
  inspectCsfIsolatedStack,
  validateCsfIsolatedStack,
  csfCanonicalDockerResourceContract,
  csfCanonicalDockerResourceNames,
  csfCanonicalDatabaseVolumeName,
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedAppEnvironment,
  inspectCsfIsolatedWorkDir,
  loadCsfIsolatedAppEnvironment,
  parseCsfIsolatedMarker,
  resolveProvidedLocalSupabaseEnv,
} from "./dv-local-env.mjs";
import {
  PINNED_RESOURCE_KINDS,
  PINNED_SUPABASE_CLI_VERSION,
  pinnedResourceNames,
  pinnedUnsupportedNames,
} from "./pinned-supabase-cli-resources.fixture";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const PORT_OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, 9];

function markerBody(options: {
  projectId: string;
  basePort: number;
  workDir: string;
  state?: "ready" | "starting";
  extra?: string;
  databaseVolume?: string;
  databaseVolumeLabel?: string;
}) {
  const state = options.state ?? "ready";
  const lines = [
    `state=${state}`,
    `project_id=${options.projectId}`,
    `base_port=${options.basePort}`,
    `work_dir=${options.workDir}`,
  ];
  if (state === "ready") {
    lines.push(
      `db_volume=${options.databaseVolume ?? `supabase_db_${options.projectId}`}`,
      `db_volume_project_label=${options.databaseVolumeLabel ?? options.projectId}`,
    );
  }
  if (options.extra) lines.push(options.extra);
  return `${lines.join("\n")}\n`;
}

// The exact disabled shape the launcher writes. Kept as a literal here rather
// than imported from the module under test, so a regression in the validator
// cannot quietly redefine what "disabled" means.
const DISABLED_GOOGLE_AUTH_LINES = [
  "[auth.external.google]",
  "enabled = false",
  'client_id = ""',
  'secret = ""',
  'redirect_uri = ""',
  "skip_nonce_check = false",
];

function configBody(
  projectId: string,
  ports: number[],
  googleAuthLines: string[] = DISABLED_GOOGLE_AUTH_LINES,
) {
  const [shadow, api, database, studio, inbucket, smtp, inspector, analytics, pooler] = ports;
  return [
    `project_id = "${projectId}"`,
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
    ...googleAuthLines,
    "[auth.external.apple]",
    "enabled = false",
    "",
  ].join("\n");
}

async function createIsolatedWorkDir(options?: {
  projectId?: string;
  basePort?: number;
  ports?: number[];
  markerSource?: string;
  markerMode?: number;
  configMode?: number;
  workDirOverride?: string;
  googleAuthLines?: string[];
}) {
  const directory = await mkdtemp(path.join(tmpdir(), "lets-assist-csf-env-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, "supabase"));
  const projectId = options?.projectId ?? "lets-assist-csf-browser-test-run";
  const basePort = options?.basePort ?? 56350;
  const ports = options?.ports ?? PORT_OFFSETS.map((offset) => basePort + offset);

  const markerPath = path.join(directory, ".lets-assist-csf-isolated-stack");
  await writeFile(
    markerPath,
    options?.markerSource ??
      markerBody({
        projectId,
        basePort,
        workDir: options?.workDirOverride ?? directory,
      }),
  );
  await chmod(markerPath, options?.markerMode ?? 0o600);

  const configPath = path.join(directory, "supabase", "config.toml");
  await writeFile(
    configPath,
    configBody(projectId, ports, options?.googleAuthLines),
  );
  await chmod(configPath, options?.configMode ?? 0o600);
  return directory;
}

const APP_ENV_VALUES: Record<string, string> = {
  API_URL: "http://127.0.0.1:56351",
  ANON_KEY: "fake-anon-token",
  SERVICE_ROLE_KEY: "fake-service-role-token",
  DB_URL: "postgresql://postgres:fake-password@127.0.0.1:56352/postgres",
  SUPABASE_URL: "http://127.0.0.1:56351",
  SUPABASE_ANON_KEY: "fake-anon-token",
  SUPABASE_DB_URL: "postgresql://postgres:fake-password@127.0.0.1:56352/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56351",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake-generated-key",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-token",
  SUPABASE_SECRET_KEY: "sb_secret_fake-generated-key",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-token",
  CSF_PROFILE_CLAIM_SECRET: "a".repeat(64),
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_VERCEL_URL: "localhost:3000",
  CSF_ISOLATED_WORK_DIR: "",
};

function appEnvBody(workDir: string, overrides: Record<string, string> = {}, extraLines: string[] = []) {
  const values = { ...APP_ENV_VALUES, CSF_ISOLATED_WORK_DIR: workDir, ...overrides };
  const lines = Object.entries(values).map(([key, value]) => `export ${key}='${value}'`);
  return `${[...lines, ...extraLines].join("\n")}\n`;
}

async function createAppEnvironment(
  overrides: Record<string, string> = {},
  extraLines: string[] = [],
  workDirOptions?: Parameters<typeof createIsolatedWorkDir>[0],
) {
  const directory = await createIsolatedWorkDir(workDirOptions);
  const appEnvPath = path.join(directory, "lets-assist-browser.sh");
  await writeFile(appEnvPath, appEnvBody(directory, overrides, extraLines));
  await chmod(appEnvPath, 0o600);
  return { directory, appEnvPath };
}

describe("local Supabase environment resolution", () => {
  test("accepts a complete explicitly provided loopback environment", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-anon",
        SUPABASE_SECRET_KEY: "local-service-role",
        SUPABASE_DB_URL: "postgresql://local-user@127.0.0.1:54322/postgres",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: "local-anon",
      serviceRoleKey: "local-service-role",
      dbUrl: "postgresql://local-user@127.0.0.1:54322/postgres",
    });
  });

  test("fails closed when an explicit Let’s Assist bundle is incomplete", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toThrow("Explicit Let’s Assist Supabase environment is incomplete");
  });

  test("prefers the explicit Let’s Assist environment over unrelated generic values", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "isolated-anon",
        SERVICE_ROLE_KEY: "isolated-service-role",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        SUPABASE_SECRET_KEY: "lets-assist-service-role",
        SUPABASE_DB_URL: "postgresql://local-user@127.0.0.1:54322/postgres",
        DB_URL: "postgresql://vela-user@127.0.0.1:56352/postgres",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: "lets-assist-anon",
      serviceRoleKey: "lets-assist-service-role",
      dbUrl: "postgresql://local-user@127.0.0.1:54322/postgres",
    });
  });

  test("does not fill an incomplete explicit bundle from a complete ambient bundle", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "vela-anon",
        SERVICE_ROLE_KEY: "vela-service-role",
        DB_URL: "postgresql://vela-user@127.0.0.1:56352/postgres",
      }),
    ).toThrow("Refusing to combine it with another environment source");
  });

  test("rejects a mixed-stack API and database port bundle", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        SUPABASE_SECRET_KEY: "lets-assist-service-role",
        SUPABASE_DB_URL:
          "postgresql://vela-user@127.0.0.1:56352/postgres",
      }),
    ).toThrow("database port must be exactly one greater than the API port");
  });

  test("normalizes localhost and 127.0.0.1 as the same loopback host", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        SUPABASE_SECRET_KEY: "lets-assist-service-role",
        SUPABASE_DB_URL:
          "postgresql://local-user@127.0.0.1:54322/postgres",
      }),
    ).toMatchObject({
      url: "http://localhost:54321",
      dbUrl: "postgresql://local-user@127.0.0.1:54322/postgres",
    });
  });

  test("accepts the standard generic environment emitted by Supabase status", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "isolated-anon",
        SERVICE_ROLE_KEY: "isolated-service-role",
        DB_URL: "postgresql://local-user@127.0.0.1:56352/postgres",
      }),
    ).toEqual({
      url: "http://127.0.0.1:56351",
      anonKey: "isolated-anon",
      serviceRoleKey: "isolated-service-role",
      dbUrl: "postgresql://local-user@127.0.0.1:56352/postgres",
    });
  });

  test("fails closed when a generic bundle is incomplete", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "isolated-anon",
        SERVICE_ROLE_KEY: "isolated-service-role",
      }),
    ).toThrow("Generic local Supabase environment is incomplete");
  });

  test("returns null only when neither environment family is present", () => {
    expect(resolveProvidedLocalSupabaseEnv({ PATH: "/usr/bin" })).toBeNull();
  });

  test("rejects a provided remote project", () => {
    expect(() => assertLocalSupabaseUrl("https://example.supabase.co")).toThrow(
      "refuses non-local Supabase URL",
    );
  });

  test("accepts only loopback Postgres URLs for database tooling", () => {
    expect(
      assertLocalPostgresUrl("postgresql://local-user@127.0.0.1:56552/postgres"),
    ).toBe("postgresql://local-user@127.0.0.1:56552/postgres");
    expect(() =>
      assertLocalPostgresUrl("postgresql://local-user@example.test/postgres"),
    ).toThrow("refuses non-local Postgres URL");
    expect(() => assertLocalPostgresUrl("https://127.0.0.1:56552/postgres")).toThrow(
      "requires a Postgres URL",
    );
  });

  test("rejects a coherent ambient Vela bundle when it does not match Let’s Assist status", () => {
    const vela = {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "vela-anon",
      SUPABASE_SECRET_KEY: "vela-service-role",
      SUPABASE_DB_URL: "postgresql://postgres@127.0.0.1:55322/postgres",
    };
    const letsAssistStatus = {
      API_URL: "http://127.0.0.1:56551",
      ANON_KEY: "lets-assist-anon",
      PUBLISHABLE_KEY: "lets-assist-publishable",
      SERVICE_ROLE_KEY: "lets-assist-service-role",
      SECRET_KEY: "lets-assist-secret",
      DB_URL: "postgresql://postgres@127.0.0.1:56552/postgres",
    };

    expect(() =>
      assertProvidedLocalSupabaseEnvMatchesStatus(
        vela,
        letsAssistStatus,
        "CSF isolated project lets-assist-csf-browser-test-run",
      ),
    ).toThrow("Refusing an ambient Vela or mixed-stack connection");
  });

  test("CSF service-role tooling rejects a coherent Vela bundle without the generated marker", () => {
    expect(() =>
      getCsfIsolatedSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "vela-anon",
        SUPABASE_SECRET_KEY: "vela-service-role",
        SUPABASE_DB_URL:
          "postgresql://postgres@127.0.0.1:55322/postgres",
      }),
    ).toThrow("requires an explicit generated CSF isolated stack");
  });

  test("accepts only a generated CSF marker whose project and ports match its config", async () => {
    const directory = await createIsolatedWorkDir();
    expect(inspectCsfIsolatedWorkDir(directory)).toMatchObject({
      workDir: await realpath(directory),
      projectId: "lets-assist-csf-browser-test-run",
      basePort: 56350,
      databaseVolume: "supabase_db_lets-assist-csf-browser-test-run",
      apiPort: 56351,
      databasePort: 56352,
    });

    const wrongProject = await createIsolatedWorkDir({ projectId: "vela-dashboard" });
    expect(() => inspectCsfIsolatedWorkDir(wrongProject)).toThrow(
      "invalid project_id",
    );

    const mismatchedPorts = await createIsolatedWorkDir({
      ports: [56350, 55321, 56352, 56353, 56354, 56355, 56356, 56357, 56359],
    });
    expect(() => inspectCsfIsolatedWorkDir(mismatchedPorts)).toThrow(
      "config api.port is 55321, expected 56351",
    );
  });
});

describe("CSF isolated marker schema", () => {
  const projectId = "lets-assist-csf-browser-test-run";

  test("accepts the exact ready and transitional schemas", () => {
    expect(
      parseCsfIsolatedMarker(
        markerBody({ projectId, basePort: 56350, workDir: "/tmp/generated" }),
      ),
    ).toEqual({
      state: "ready",
      projectId,
      runId: "test-run",
      basePort: 56350,
      workDir: "/tmp/generated",
      databaseVolume: `supabase_db_${projectId}`,
      databaseVolumeLabel: projectId,
    });

    expect(
      parseCsfIsolatedMarker(
        markerBody({ projectId, basePort: 56350, workDir: "/tmp/generated", state: "starting" }),
      ),
    ).toMatchObject({ state: "starting", databaseVolume: undefined });
  });

  test("rejects duplicate, unknown, missing, and malformed fields", () => {
    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({
          projectId,
          basePort: 56350,
          workDir: "/tmp/generated",
          extra: `project_id=${projectId}`,
        }),
      ),
    ).toThrow("repeats the field: project_id");

    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({
          projectId,
          basePort: 56350,
          workDir: "/tmp/generated",
          extra: "adopted=true",
        }),
      ),
    ).toThrow("unknown field: adopted");

    expect(() =>
      parseCsfIsolatedMarker(`state=ready\nproject_id=${projectId}\nbase_port=56350\n`),
    ).toThrow("missing work_dir");

    expect(() =>
      parseCsfIsolatedMarker(`state=ready\nnot a field\n`),
    ).toThrow("line 2 is malformed");

    expect(() =>
      parseCsfIsolatedMarker(`state=ready\nproject_id=${projectId}\nbase_port=56350`),
    ).toThrow("truncated");
  });

  test("ready requires the volume fields and transitional forbids them", () => {
    expect(() =>
      parseCsfIsolatedMarker(
        `state=ready\nproject_id=${projectId}\nbase_port=56350\nwork_dir=/tmp/generated\n`,
      ),
    ).toThrow("missing db_volume");

    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({ projectId, basePort: 56350, workDir: "/tmp/generated" }).replace(
          "state=ready",
          "state=starting",
        ),
      ),
    ).toThrow("starting marker must not record db_volume");
  });

  test("rejects a wrong volume name, wrong label, bad base port, and relative work_dir", () => {
    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({
          projectId,
          basePort: 56350,
          workDir: "/tmp/generated",
          databaseVolume: "supabase_db_someone_else",
        }),
      ),
    ).toThrow("does not record the expected database volume identity");

    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({
          projectId,
          basePort: 56350,
          workDir: "/tmp/generated",
          databaseVolumeLabel: "someone-else",
        }),
      ),
    ).toThrow("does not carry the exact project label");

    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({ projectId, basePort: 80, workDir: "/tmp/generated" }),
      ),
    ).toThrow("invalid base_port");

    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({ projectId, basePort: 56350, workDir: "relative/path" }),
      ),
    ).toThrow("non-absolute work_dir");
  });

  test("rejects a run ID longer than the launcher's 16-character contract", () => {
    expect(() =>
      parseCsfIsolatedMarker(
        markerBody({
          projectId: `lets-assist-csf-browser-${"a".repeat(17)}`,
          basePort: 56350,
          workDir: "/tmp/generated",
        }),
      ),
    ).toThrow("invalid project_id");
  });
});

// ---------------------------------------------------------------------------
// The generated runtime must be provider-disabled by construction.
//
// The shared root config enables Google and resolves its client ID, secret, and
// redirect URI through `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_*)`. Copied verbatim
// into a generated isolated stack, those indirections resolve against whatever
// the operator's shell exports — a real OAuth credential on a runtime whose
// premise is that it touches nothing real.
// ---------------------------------------------------------------------------
describe("generated isolated config is provider-disabled", () => {
  const launcherSource = readFileSync(
    new URL("./start-dvhs-csf-isolated-stack.sh", import.meta.url),
    "utf8",
  );

  test("the launcher writes exactly the shape the validator accepts", () => {
    // One contract, two files. The launcher rewrites the block and
    // dv-local-env.mjs re-validates the written file, so they have to agree
    // line for line or one of them is wrong.
    expect(CSF_DISABLED_GOOGLE_AUTH_BLOCK).toBe(
      DISABLED_GOOGLE_AUTH_LINES.join("\n"),
    );
    for (const line of DISABLED_GOOGLE_AUTH_LINES) {
      expect(launcherSource).toContain(line);
    }
    // And the launcher refuses to write a config that still carries the
    // indirection at all.
    expect(launcherSource).toContain(
      'if (source.includes("SUPABASE_AUTH_EXTERNAL_GOOGLE")) {',
    );
    expect(launcherSource).toContain(
      "Expected exactly one [auth.external.google] section",
    );
  });

  test("the fixed app port is a shared constant, never a base-relative offset", () => {
    expect(CSF_ISOLATED_APP_PORT).toBe(3000);
    expect(launcherSource).toContain("APP_PORT=3000");
    // 3000 must not appear in the Supabase bundle, and the launcher must refuse
    // a base that would place a Supabase service on it.
    expect(launcherSource).toContain("PORT_OFFSETS=(0 1 2 3 4 5 6 7 9)");
    expect(launcherSource).toContain(
      "would place a Supabase service on the fixed app port",
    );
  });

  test("accepts the exact disabled shape", async () => {
    const directory = await createIsolatedWorkDir();
    expect(inspectCsfIsolatedWorkDir(directory).basePort).toBe(56350);
  });

  test("rejects a re-enabled provider, copied credentials, and shape drift", async () => {
    const cases: Array<[string, string[], RegExp]> = [
      [
        "re-enabled",
        [
          "[auth.external.google]",
          "enabled = true",
          'client_id = ""',
          'secret = ""',
          'redirect_uri = ""',
          "skip_nonce_check = false",
        ],
        /not the exact disabled shape/u,
      ],
      [
        "copied literal client id and secret",
        [
          "[auth.external.google]",
          "enabled = false",
          'client_id = "1234-real.apps.googleusercontent.com"',
          'secret = "GOCSPX-real-secret"',
          'redirect_uri = ""',
          "skip_nonce_check = false",
        ],
        /not the exact disabled shape/u,
      ],
      [
        "copied redirect uri",
        [
          "[auth.external.google]",
          "enabled = false",
          'client_id = ""',
          'secret = ""',
          'redirect_uri = "https://lets-assist.com/api/calendar/google/callback"',
          "skip_nonce_check = false",
        ],
        /not the exact disabled shape/u,
      ],
      [
        "skip_nonce_check re-enabled",
        [
          "[auth.external.google]",
          "enabled = false",
          'client_id = ""',
          'secret = ""',
          'redirect_uri = ""',
          "skip_nonce_check = true",
        ],
        /not the exact disabled shape/u,
      ],
      [
        "extra key inside the block",
        [...DISABLED_GOOGLE_AUTH_LINES, 'url = "https://accounts.google.com"'],
        /not the exact disabled shape/u,
      ],
      [
        "missing block",
        [],
        /exactly one \[auth\.external\.google\] section, found 0/u,
      ],
      [
        "duplicate block",
        [...DISABLED_GOOGLE_AUTH_LINES, ...DISABLED_GOOGLE_AUTH_LINES],
        /exactly one \[auth\.external\.google\] section, found 2/u,
      ],
    ];

    for (const [label, googleAuthLines, expected] of cases) {
      const directory = await createIsolatedWorkDir({ googleAuthLines });
      expect(() => inspectCsfIsolatedWorkDir(directory), label).toThrow(expected);
    }
  });

  test("rejects an ambient env() indirection even when the shape looks disabled", async () => {
    // The subtle one: the block reads as inert in the file and resolves to a
    // real credential the moment the CLI reads it in a shell that exports one.
    const directory = await createIsolatedWorkDir({
      googleAuthLines: [
        ...DISABLED_GOOGLE_AUTH_LINES,
        "[auth.external.azure]",
        'secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"',
      ],
    });
    expect(() => inspectCsfIsolatedWorkDir(directory)).toThrow(
      /still references an ambient SUPABASE_AUTH_EXTERNAL_GOOGLE_\* value/u,
    );
  });

  test("an ambient Google environment cannot change the validated result", async () => {
    const planted = {
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: "planted-client-id",
      SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: "planted-secret",
      SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI: "https://planted.invalid/cb",
      GOOGLE_CLIENT_SECRET: "planted-google-secret",
    };
    for (const [key, value] of Object.entries(planted)) process.env[key] = value;
    try {
      const disabled = await createIsolatedWorkDir();
      expect(inspectCsfIsolatedWorkDir(disabled).projectId).toBe(
        "lets-assist-csf-browser-test-run",
      );

      const enabled = await createIsolatedWorkDir({
        googleAuthLines: [
          "[auth.external.google]",
          "enabled = true",
          'client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"',
          'secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"',
          'redirect_uri = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI)"',
          "skip_nonce_check = true",
        ],
      });
      expect(() => inspectCsfIsolatedWorkDir(enabled)).toThrow();
    } finally {
      for (const key of Object.keys(planted)) delete process.env[key];
    }
  });
});

describe("CSF isolated work directory posture", () => {
  test("rejects a transitional marker, a mismatched work_dir, and every port mismatch", async () => {
    const transitional = await createIsolatedWorkDir({
      markerSource: markerBody({
        projectId: "lets-assist-csf-browser-test-run",
        basePort: 56350,
        workDir: "/tmp/generated",
        state: "starting",
      }),
    });
    expect(() => inspectCsfIsolatedWorkDir(transitional)).toThrow("is not ready");

    const wrongWorkDir = await createIsolatedWorkDir({ workDirOverride: tmpdir() });
    expect(() => inspectCsfIsolatedWorkDir(wrongWorkDir)).toThrow(
      "work_dir does not match the directory it was found in",
    );

    // All nine offsets are validated, not only the API and database ports.
    for (const index of PORT_OFFSETS.keys()) {
      const ports = PORT_OFFSETS.map((value) => 56350 + value);
      ports[index] = 59999;
      const directory = await createIsolatedWorkDir({ ports });
      // Each offset is validated by its own exact section and key, so a swapped
      // or wrong port is named precisely rather than only failing the multiset.
      expect(() => inspectCsfIsolatedWorkDir(directory)).toThrow(
        /config [a-z_.]+ is 59999, expected \d+/u,
      );
    }

    // A swap between two mapped ports keeps the multiset intact and must still
    // fail on the exact section/key mapping.
    const swapped = PORT_OFFSETS.map((value) => 56350 + value);
    [swapped[1], swapped[3]] = [swapped[3], swapped[1]];
    const swappedDirectory = await createIsolatedWorkDir({ ports: swapped });
    expect(() => inspectCsfIsolatedWorkDir(swappedDirectory)).toThrow(
      /config (api|studio)\.port is \d+, expected \d+/u,
    );
  });

  test("rejects hardlinked marker and config files", async () => {
    const linkedMarker = await createIsolatedWorkDir();
    await link(
      path.join(linkedMarker, ".lets-assist-csf-isolated-stack"),
      path.join(linkedMarker, "marker-second-name"),
    );
    expect(() => inspectCsfIsolatedWorkDir(linkedMarker)).toThrow(
      /marker must have exactly one hard link/u,
    );

    const linkedConfig = await createIsolatedWorkDir();
    await link(
      path.join(linkedConfig, "supabase", "config.toml"),
      path.join(linkedConfig, "supabase", "config-second-name.toml"),
    );
    expect(() => inspectCsfIsolatedWorkDir(linkedConfig)).toThrow(
      /config must have exactly one hard link/u,
    );
  });

  test("rejects marker or config bytes changed between validation and handoff", async () => {
    const markerCase = await createIsolatedWorkDir();
    let inspection = inspectCsfIsolatedStack(markerCase, { requireState: "ready" });
    await writeFile(
      path.join(markerCase, ".lets-assist-csf-isolated-stack"),
      markerBody({
        projectId: "lets-assist-csf-browser-test-run",
        basePort: 56350,
        workDir: markerCase,
        databaseVolumeLabel: "someone-else",
      }),
    );
    expect(() => commitCsfIsolatedStack(inspection)).toThrow(
      /marker (descriptor|pathname) changed/u,
    );

    const configCase = await createIsolatedWorkDir();
    inspection = inspectCsfIsolatedStack(configCase, { requireState: "ready" });
    const configPath = path.join(configCase, "supabase", "config.toml");
    await writeFile(
      configPath,
      configBody(
        "lets-assist-csf-browser-test-run",
        PORT_OFFSETS.map((offset) => 59000 + offset),
      ),
    );
    await chmod(configPath, 0o600);
    expect(() => commitCsfIsolatedStack(inspection)).toThrow(
      /config (descriptor|pathname) changed/u,
    );
  });

  test("emits only the bounded exact-key handoff record", async () => {
    const directory = await createIsolatedWorkDir();
    const validated = validateCsfIsolatedStack(directory, { requireState: "ready" });

    expect(Object.keys(validated).sort()).toEqual([...CSF_STACK_HANDOFF_KEYS].sort());
    expect(validated.state).toBe("ready");
    expect(validated.project_id).toBe("lets-assist-csf-browser-test-run");
    expect(validated.run_id).toBe("test-run");
    expect(validated.base_port).toBe("56350");
    expect(validated.work_dir).toBe(await realpath(directory));
    expect(validated.db_volume).toBe(
      csfCanonicalDatabaseVolumeName("lets-assist-csf-browser-test-run"),
    );
    for (const value of Object.values(validated)) {
      expect(value).not.toContain("\n");
    }

    // A transitional marker validates too, and reports no volume identity.
    const transitional = await createIsolatedWorkDir({
      markerSource: markerBody({
        projectId: "lets-assist-csf-browser-test-run",
        basePort: 56350,
        workDir: "",
        state: "starting",
      }),
    });
    const transitionalMarker = path.join(
      transitional,
      ".lets-assist-csf-isolated-stack",
    );
    await writeFile(
      transitionalMarker,
      markerBody({
        projectId: "lets-assist-csf-browser-test-run",
        basePort: 56350,
        workDir: transitional,
        state: "starting",
      }),
    );
    await chmod(transitionalMarker, 0o600);
    const startingRecord = validateCsfIsolatedStack(transitional, {
      requireState: "starting",
    });
    expect(startingRecord.state).toBe("starting");
    expect(startingRecord.db_volume).toBe("");
    expect(startingRecord.db_volume_project_label).toBe("");
  });

  test("rejects a symlinked work directory before it is resolved", async () => {
    const directory = await createIsolatedWorkDir();
    const parent = await mkdtemp(path.join(tmpdir(), "lets-assist-csf-link-"));
    temporaryDirectories.push(parent);
    const linkPath = path.join(parent, "linked-stack");
    await symlink(directory, linkPath);

    expect(() => inspectCsfIsolatedWorkDir(linkPath)).toThrow(
      "Refusing a symlinked CSF isolated work directory",
    );
  });

  test("rejects group-readable or non-regular marker and config files", async () => {
    const looseMarker = await createIsolatedWorkDir({ markerMode: 0o644 });
    expect(() => inspectCsfIsolatedWorkDir(looseMarker)).toThrow(
      "group/world-accessible",
    );

    const looseConfig = await createIsolatedWorkDir({ configMode: 0o640 });
    expect(() => inspectCsfIsolatedWorkDir(looseConfig)).toThrow(
      "group/world-accessible",
    );

    const symlinkedMarker = await createIsolatedWorkDir();
    const markerPath = path.join(symlinkedMarker, ".lets-assist-csf-isolated-stack");
    const realMarker = path.join(symlinkedMarker, "real-marker");
    await rename(markerPath, realMarker);
    await symlink(realMarker, markerPath);
    expect(() => inspectCsfIsolatedWorkDir(symlinkedMarker)).toThrow(
      "Refusing a symlinked CSF isolated file",
    );
  });
});

describe("CSF isolated app environment exact-byte loading", () => {
  test("loads the validated values without spawning a single command", async () => {
    const { directory } = await createAppEnvironment();
    const originalPath = process.env.PATH;
    try {
      // An empty PATH makes any subprocess spawn fail, so a passing load proves
      // no live command ran before the verified handoff.
      process.env.PATH = "";
      const values = loadCsfIsolatedAppEnvironment(directory) as Record<string, string>;
      expect(values.API_URL).toBe("http://127.0.0.1:56351");
      expect(values.CSF_ISOLATED_WORK_DIR).toBe(directory);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  test("rejects duplicate, unknown, non-export, and command-bearing lines", async () => {
    const duplicate = await createAppEnvironment({}, ["export API_URL='http://127.0.0.1:56351'"]);
    expect(() => loadCsfIsolatedAppEnvironment(duplicate.directory)).toThrow(
      "exports API_URL more than once",
    );

    const unknown = await createAppEnvironment({}, ["export ADOPTED_KEY='yes'"]);
    expect(() => loadCsfIsolatedAppEnvironment(unknown.directory)).toThrow(
      "unknown key: ADOPTED_KEY",
    );

    const nonExport = await createAppEnvironment({}, ["API_URL=http://127.0.0.1:56351"]);
    expect(() => loadCsfIsolatedAppEnvironment(nonExport.directory)).toThrow(
      "is not an allowlisted single-quoted export",
    );

    const comment = await createAppEnvironment({}, ["# generated"]);
    expect(() => loadCsfIsolatedAppEnvironment(comment.directory)).toThrow(
      "is not an allowlisted single-quoted export",
    );

    for (const injected of [
      "export API_URL='$(id)'",
      "export API_URL='`id`'",
      "export API_URL='${HOME}'",
      "export API_URL='http://127.0.0.1:56351'; id",
    ]) {
      const command = await createAppEnvironment({}, [injected]);
      expect(() => loadCsfIsolatedAppEnvironment(command.directory)).toThrow(
        "is not an allowlisted single-quoted export",
      );
    }
  });

  test("requires the exact Let’s Assist origin rather than mutual agreement", async () => {
    const wrongSite = await createAppEnvironment({
      NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
      SITE_URL: "http://localhost:3001",
      NEXT_PUBLIC_VERCEL_URL: "localhost:3001",
    });
    expect(() => loadCsfIsolatedAppEnvironment(wrongSite.directory)).toThrow(
      "site URL must be exactly http://localhost:3000",
    );

    const wrongVercelUrl = await createAppEnvironment({
      NEXT_PUBLIC_VERCEL_URL: "localhost:3002",
    });
    expect(() => loadCsfIsolatedAppEnvironment(wrongVercelUrl.directory)).toThrow(
      "NEXT_PUBLIC_VERCEL_URL must be exactly localhost:3000",
    );
  });

  test("rejects endpoints, secrets, and work directories that disagree with the marker", async () => {
    const mismatchedPort = await createAppEnvironment({
      API_URL: "http://127.0.0.1:59999",
      SUPABASE_URL: "http://127.0.0.1:59999",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59999",
    });
    expect(() => loadCsfIsolatedAppEnvironment(mismatchedPort.directory)).toThrow(
      "API port 59999 does not match",
    );

    const disagreeing = await createAppEnvironment({
      SUPABASE_URL: "http://127.0.0.1:56351/",
    });
    expect(() => loadCsfIsolatedAppEnvironment(disagreeing.directory)).toThrow(
      "API endpoints disagree between API_URL and SUPABASE_URL",
    );

    const badSecret = await createAppEnvironment({ CSF_PROFILE_CLAIM_SECRET: "not-hex" });
    expect(() => loadCsfIsolatedAppEnvironment(badSecret.directory)).toThrow(
      "profile-claim secret is not a generated 32-byte hex value",
    );

    const foreignWorkDir = await createAppEnvironment({ CSF_ISOLATED_WORK_DIR: tmpdir() });
    expect(() => loadCsfIsolatedAppEnvironment(foreignWorkDir.directory)).toThrow(
      "work directory does not match the validated marker",
    );
  });

  test("rejects a loose mode and a pre-existing hard link", async () => {
    const loose = await createAppEnvironment();
    await chmod(loose.appEnvPath, 0o644);
    expect(() => loadCsfIsolatedAppEnvironment(loose.directory)).toThrow("must be mode 600");

    const linked = await createAppEnvironment();
    await link(linked.appEnvPath, path.join(linked.directory, "second-name"));
    expect(() => loadCsfIsolatedAppEnvironment(linked.directory)).toThrow(
      "must have exactly one hard link",
    );
  });

  test("rejects every replacement or mutation between validation and handoff", async () => {
    const original = appEnvBody("");

    // Rename swap: a different inode moved onto the validated pathname.
    const renamed = await createAppEnvironment();
    let inspection = inspectCsfIsolatedAppEnvironment(renamed.directory);
    const replacement = path.join(renamed.directory, "replacement");
    await writeFile(replacement, appEnvBody(renamed.directory, { ANON_KEY: "attacker-token" }));
    await chmod(replacement, 0o600);
    await rename(replacement, renamed.appEnvPath);
    expect(() => commitCsfIsolatedAppEnvironment(inspection)).toThrow(
      /changed \((nlink|ino|dev)\) between validation and handoff/u,
    );

    // Byte-identical swap: same content, different inode.
    const identical = await createAppEnvironment();
    inspection = inspectCsfIsolatedAppEnvironment(identical.directory);
    const twin = path.join(identical.directory, "twin");
    await writeFile(twin, await readFile(identical.appEnvPath, "utf8"));
    await chmod(twin, 0o600);
    await rename(twin, identical.appEnvPath);
    expect(() => commitCsfIsolatedAppEnvironment(inspection)).toThrow(
      /changed \((nlink|ino|dev)\) between validation and handoff/u,
    );

    // Same-size in-place mutation through the same inode.
    const mutated = await createAppEnvironment();
    inspection = inspectCsfIsolatedAppEnvironment(mutated.directory);
    const before = await readFile(mutated.appEnvPath, "utf8");
    const sameSize = before.replace("fake-anon-token", "faKe-anon-token");
    expect(sameSize.length).toBe(before.length);
    const fd = openSync(mutated.appEnvPath, "r+");
    writeSync(fd, sameSize, 0, "utf8");
    closeSync(fd);
    expect(() => commitCsfIsolatedAppEnvironment(inspection)).toThrow(
      "changed (mtimeMs) between validation and handoff",
    );

    // Append and truncate.
    const appended = await createAppEnvironment();
    inspection = inspectCsfIsolatedAppEnvironment(appended.directory);
    await writeFile(appended.appEnvPath, `${await readFile(appended.appEnvPath, "utf8")}export SITE_URL='http://localhost:3000'\n`);
    expect(() => commitCsfIsolatedAppEnvironment(inspection)).toThrow(
      "changed (size) between validation and handoff",
    );

    const truncated = await createAppEnvironment();
    inspection = inspectCsfIsolatedAppEnvironment(truncated.directory);
    await truncate(truncated.appEnvPath, 10);
    expect(() => commitCsfIsolatedAppEnvironment(inspection)).toThrow(
      "changed (size) between validation and handoff",
    );

    // Hardlink replacement keeps the inode but changes the link count.
    const hardlinked = await createAppEnvironment();
    inspection = inspectCsfIsolatedAppEnvironment(hardlinked.directory);
    await link(hardlinked.appEnvPath, path.join(hardlinked.directory, "attacker-link"));
    expect(() => commitCsfIsolatedAppEnvironment(inspection)).toThrow(
      "changed (nlink) between validation and handoff",
    );

    expect(original.length).toBeGreaterThan(0);
  });

  test("the pathname check rejects a swap even when the held descriptor is untouched", async () => {
    const { directory } = await createAppEnvironment();
    const inspection = inspectCsfIsolatedAppEnvironment(directory);

    // A separate file with byte-identical content and mode. Redirecting the
    // recorded pathname at it leaves the descriptor posture unchanged, which is
    // exactly the case the pathname comparison exists to catch.
    const decoyDirectory = await createAppEnvironment();
    inspection.appEnvPath = decoyDirectory.appEnvPath;

    expect(() => commitCsfIsolatedAppEnvironment(inspection)).toThrow(
      /pathname changed \((ino|dev)\) between validation and handoff/u,
    );
  });
});

describe("pinned canonical Docker identity", () => {
  const projectId = "lets-assist-csf-browser-test-run";

  test("matches the checked-in pinned CLI oracle exactly, kind by kind", () => {
    // The oracle is a literal transcription of Supabase CLI v2.111.0, not a
    // reflection of the implementation. Equality is asserted in both directions
    // so neither an omission nor an invented extra can pass.
    for (const kind of PINNED_RESOURCE_KINDS) {
      const implemented = csfCanonicalDockerResourceNames(projectId, kind);
      const official = pinnedResourceNames(projectId, kind);

      expect([...implemented].sort()).toEqual([...official].sort());
      expect(implemented.length).toBe(official.length);
      expect(new Set(implemented).size).toBe(implemented.length);
    }

    // Exact cardinality of the tagged legacy shell: fourteen containers, three
    // named volumes, one network.
    const contract = csfCanonicalDockerResourceContract(projectId);
    expect(contract.container.length).toBe(14);
    expect(contract.volume.length).toBe(3);
    expect(contract.network.length).toBe(1);
    expect(Object.keys(contract).sort()).toEqual(["container", "network", "volume"]);

    for (const kind of PINNED_RESOURCE_KINDS) {
      for (const name of contract[kind]) {
        expect(name.endsWith(projectId)).toBe(true);
        expect(name).toBe(`${name.slice(0, -projectId.length)}${projectId}`);
      }
    }
  });

  test("never readmits a name the pinned CLI does not create", () => {
    // Each of these was previously listed as a stable resource. Re-admitting one
    // would hand deletion authority over a resource the CLI never created, or
    // let a foreign resource satisfy the post-start ownership proof.
    for (const kind of PINNED_RESOURCE_KINDS) {
      const implemented = csfCanonicalDockerResourceNames(projectId, kind);
      for (const unsupported of pinnedUnsupportedNames(projectId, kind)) {
        expect(implemented).not.toContain(unsupported);
      }
    }

    // A constant existing at the tag is not evidence a resource is created:
    // DifferId is defined but no persistent named differ container exists, and
    // migra/pg_prove/test helpers run without stable container names.
    const everyImplementedName = PINNED_RESOURCE_KINDS.flatMap((kind) =>
      csfCanonicalDockerResourceNames(projectId, kind),
    );
    for (const transient of [
      `supabase_differ_${projectId}`,
      `supabase_migra_${projectId}`,
      `supabase_pg_prove_${projectId}`,
      `supabase_test_${projectId}`,
      `realtime-dev.supabase_realtime_${projectId}`,
      `storage_imgproxy_${projectId}`,
      `supabase_config_${projectId}`,
    ]) {
      expect(everyImplementedName).not.toContain(transient);
    }
  });

  test("keeps every resource in exactly one kind", () => {
    const contract = csfCanonicalDockerResourceContract(projectId);

    // The database volume is a volume; the equally-named container is a
    // different Docker namespace and must not be reachable through it.
    expect(contract.volume).toContain(csfCanonicalDatabaseVolumeName(projectId));
    expect(contract.network).not.toContain(csfCanonicalDatabaseVolumeName(projectId));

    // Kong, realtime, and imgproxy are containers only; a volume by any of those
    // names is foreign.
    for (const containerOnly of [
      `supabase_kong_${projectId}`,
      `supabase_realtime_${projectId}`,
      `supabase_imgproxy_${projectId}`,
      `supabase_inbucket_${projectId}`,
    ]) {
      expect(contract.container).toContain(containerOnly);
      expect(contract.volume).not.toContain(containerOnly);
      expect(contract.network).not.toContain(containerOnly);
    }

    // The network name is a network only.
    expect(contract.network).toEqual([`supabase_network_${projectId}`]);
    expect(contract.container).not.toContain(`supabase_network_${projectId}`);
    expect(contract.volume).not.toContain(`supabase_network_${projectId}`);

    // Only db, storage, and edge runtime legitimately appear in two kinds, and the oracle says
    // so explicitly rather than the implementation deciding it.
    const sharedAcrossKinds = contract.container.filter((name: string) =>
      contract.volume.includes(name),
    );
    expect(sharedAcrossKinds.sort()).toEqual(
      [
        `supabase_db_${projectId}`,
        `supabase_storage_${projectId}`,
        `supabase_edge_runtime_${projectId}`,
      ].sort(),
    );
  });

  test("the oracle itself pins the CLI version this repository requires", async () => {
    expect(PINNED_SUPABASE_CLI_VERSION).toBe("2.111.0");
    const helper = await readFile(
      path.join(import.meta.dir, "require-supabase-cli-version.sh"),
      "utf8",
    );
    expect(helper).toContain(PINNED_SUPABASE_CLI_VERSION);
  });

  test("rejects an unknown Docker resource kind", () => {
    expect(() =>
      // @ts-expect-error - deliberately outside the typed contract
      csfCanonicalDockerResourceNames("lets-assist-csf-browser-test-run", "service"),
    ).toThrow("Unknown canonical Docker resource kind: service");
  });

  test("refuses to derive names for a project outside the isolated contract", () => {
    expect(() => csfCanonicalDockerResourceNames("vela-dashboard", "volume")).toThrow(
      "Refusing canonical Docker names for a non-isolated project",
    );
  });

  test("both isolated shell scripts select on the exact same project label key", async () => {
    expect(CSF_PROJECT_LABEL_KEY).toBe("com.supabase.cli.project");

    for (const script of [
      "start-dvhs-csf-isolated-stack.sh",
      "stop-dvhs-csf-isolated-stack.sh",
    ]) {
      const source = await readFile(
        path.join(import.meta.dir, script),
        "utf8",
      );
      expect(source).toContain(CSF_PROJECT_LABEL_KEY);
      expect(source).toMatch(
        /PROJECT_LABEL="(\$\{PROJECT_LABEL_KEY\}|com\.supabase\.cli\.project)=\$\{PROJECT_ID\}"/u,
      );
      // Both derive their exact names from the one pinned list, never a glob.
      expect(source).toContain("--canonical-docker-names");
      expect(source).not.toMatch(/supabase_\*_"?\$\{PROJECT_ID\}/u);
    }
  });
});
