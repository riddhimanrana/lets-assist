import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  link,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { closeSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CSF_PROJECT_LABEL_KEY,
  commitCsfIsolatedAppEnvironment,
  csfCanonicalDockerResourceContract,
  csfCanonicalDockerResourceNames,
  csfCanonicalDatabaseVolumeName,
  inspectCsfIsolatedAppEnvironment,
  loadCsfIsolatedAppEnvironment,
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
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
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
  ] = ports;
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
  const ports =
    options?.ports ?? PORT_OFFSETS.map((offset) => basePort + offset);

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
  SUPABASE_DB_URL:
    "postgresql://postgres:fake-password@127.0.0.1:56352/postgres",
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

function appEnvBody(
  workDir: string,
  overrides: Record<string, string> = {},
  extraLines: string[] = [],
) {
  const values = {
    ...APP_ENV_VALUES,
    CSF_ISOLATED_WORK_DIR: workDir,
    ...overrides,
  };
  const lines = Object.entries(values).map(
    ([key, value]) => `export ${key}='${value}'`,
  );
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

describe("CSF isolated app environment exact-byte loading", () => {
  test("loads the validated values without spawning a single command", async () => {
    const { directory } = await createAppEnvironment();
    const originalPath = process.env.PATH;
    try {
      // An empty PATH makes any subprocess spawn fail, so a passing load proves
      // no live command ran before the verified handoff.
      process.env.PATH = "";
      const values = loadCsfIsolatedAppEnvironment(directory) as Record<
        string,
        string
      >;
      expect(values.API_URL).toBe("http://127.0.0.1:56351");
      expect(values.CSF_ISOLATED_WORK_DIR).toBe(directory);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  test("rejects duplicate, unknown, non-export, and command-bearing lines", async () => {
    const duplicate = await createAppEnvironment({}, [
      "export API_URL='http://127.0.0.1:56351'",
    ]);
    expect(() => loadCsfIsolatedAppEnvironment(duplicate.directory)).toThrow(
      "exports API_URL more than once",
    );

    const unknown = await createAppEnvironment({}, [
      "export ADOPTED_KEY='yes'",
    ]);
    expect(() => loadCsfIsolatedAppEnvironment(unknown.directory)).toThrow(
      "unknown key: ADOPTED_KEY",
    );

    const nonExport = await createAppEnvironment({}, [
      "API_URL=http://127.0.0.1:56351",
    ]);
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
    expect(() =>
      loadCsfIsolatedAppEnvironment(wrongVercelUrl.directory),
    ).toThrow("NEXT_PUBLIC_VERCEL_URL must be exactly localhost:3000");
  });

  test("rejects endpoints, secrets, and work directories that disagree with the marker", async () => {
    const mismatchedPort = await createAppEnvironment({
      API_URL: "http://127.0.0.1:59999",
      SUPABASE_URL: "http://127.0.0.1:59999",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59999",
    });
    expect(() =>
      loadCsfIsolatedAppEnvironment(mismatchedPort.directory),
    ).toThrow("API port 59999 does not match");

    const disagreeing = await createAppEnvironment({
      SUPABASE_URL: "http://127.0.0.1:56351/",
    });
    expect(() => loadCsfIsolatedAppEnvironment(disagreeing.directory)).toThrow(
      "API endpoints disagree between API_URL and SUPABASE_URL",
    );

    const badSecret = await createAppEnvironment({
      CSF_PROFILE_CLAIM_SECRET: "not-hex",
    });
    expect(() => loadCsfIsolatedAppEnvironment(badSecret.directory)).toThrow(
      "profile-claim secret is not a generated 32-byte hex value",
    );

    const foreignWorkDir = await createAppEnvironment({
      CSF_ISOLATED_WORK_DIR: tmpdir(),
    });
    expect(() =>
      loadCsfIsolatedAppEnvironment(foreignWorkDir.directory),
    ).toThrow("work directory does not match the validated marker");
  });

  test("rejects a loose mode and a pre-existing hard link", async () => {
    const loose = await createAppEnvironment();
    await chmod(loose.appEnvPath, 0o644);
    expect(() => loadCsfIsolatedAppEnvironment(loose.directory)).toThrow(
      "must be mode 600",
    );

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
    await writeFile(
      replacement,
      appEnvBody(renamed.directory, { ANON_KEY: "attacker-token" }),
    );
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
    await writeFile(
      appended.appEnvPath,
      `${await readFile(appended.appEnvPath, "utf8")}export SITE_URL='http://localhost:3000'\n`,
    );
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
    await link(
      hardlinked.appEnvPath,
      path.join(hardlinked.directory, "attacker-link"),
    );
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
    expect(Object.keys(contract).sort()).toEqual([
      "container",
      "network",
      "volume",
    ]);

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
    expect(contract.volume).toContain(
      csfCanonicalDatabaseVolumeName(projectId),
    );
    expect(contract.network).not.toContain(
      csfCanonicalDatabaseVolumeName(projectId),
    );

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
      csfCanonicalDockerResourceNames(
        "lets-assist-csf-browser-test-run",
        // @ts-expect-error - deliberately outside the typed contract
        "service",
      ),
    ).toThrow("Unknown canonical Docker resource kind: service");
  });

  test("refuses to derive names for a project outside the isolated contract", () => {
    expect(() =>
      csfCanonicalDockerResourceNames("vela-dashboard", "volume"),
    ).toThrow("Refusing canonical Docker names for a non-isolated project");
  });

  test("both isolated shell scripts select on the exact same project label key", async () => {
    expect(CSF_PROJECT_LABEL_KEY).toBe("com.supabase.cli.project");

    for (const script of [
      "start-dvhs-csf-isolated-stack.sh",
      "stop-dvhs-csf-isolated-stack.sh",
    ]) {
      const source = await readFile(path.join(import.meta.dir, script), "utf8");
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
