#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

const EXPLICIT_SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
];

const GENERIC_SUPABASE_ENV_KEYS = [
  "API_URL",
  "ANON_KEY",
  "SERVICE_ROLE_KEY",
  "DB_URL",
];

// The launcher caps its run ID at 16 characters, so the derived project ID has
// exactly this shape. Anything longer would be silently truncated by the CLI and
// would break every exact ownership comparison below.
const CSF_ISOLATED_PROJECT_PREFIX = "lets-assist-csf-browser-";
const CSF_ISOLATED_PROJECT_PATTERN =
  /^lets-assist-csf-browser-[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/u;
const CSF_ISOLATED_MARKER = ".lets-assist-csf-isolated-stack";
const CSF_ISOLATED_APP_ENV_FILE = "lets-assist-browser.sh";

// The exact port bundle the launcher writes into the generated config.
const CSF_ISOLATED_PORT_OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, 9];

// The app port is fixed independently of the Supabase base port. It is
// deliberately *not* a base-relative offset: the isolated Supabase bundle and
// the isolated app are two separate resources, and deriving one from the other
// would silently move the app whenever the base moved.
//
// It defaults to 3000 and is overridable ONLY through CSF_ISOLATED_APP_PORT, so
// a developer already serving their own work on 3000 can run the isolated stack
// beside it instead of having to stop one to use the other. Everything derived
// from the port — the pinned origin, the preflight, the port claim — reads this
// one value, so an override moves the whole stack coherently or not at all.
export const CSF_ISOLATED_APP_PORT = resolveIsolatedAppPort();

function resolveIsolatedAppPort() {
  const requested = (process.env.CSF_ISOLATED_APP_PORT ?? "").trim();
  if (requested === "") return 3000;
  if (!/^\d+$/u.test(requested)) {
    throw new Error(
      "CSF_ISOLATED_APP_PORT must be an integer between 1024 and 65535.",
    );
  }
  const port = Number.parseInt(requested, 10);
  if (port < 1024 || port > 65535) {
    throw new Error(
      "CSF_ISOLATED_APP_PORT must be an integer between 1024 and 65535.",
    );
  }
  return port;
}

// The launcher pins the app to this loopback origin; nothing else is accepted.
const CSF_ISOLATED_SITE_URL = `http://localhost:${CSF_ISOLATED_APP_PORT}`;
const CSF_ISOLATED_VERCEL_URL = `localhost:${CSF_ISOLATED_APP_PORT}`;

// The exact provider-disabled `[auth.external.google]` shape the launcher writes
// into the generated config, and the only shape that validates.
//
// The shared root config carries `enabled = true` plus three
// `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_*)` indirections. Copying that verbatim
// into a generated isolated runtime would let whatever the operator's shell
// happens to export become a live OAuth provider on a stack whose whole purpose
// is that it touches nothing real. So the block is rewritten to literal empty
// values — never to `env(...)`, which is the indirection itself.
export const CSF_DISABLED_GOOGLE_AUTH_KEYS = [
  "enabled = false",
  'client_id = ""',
  'secret = ""',
  'redirect_uri = ""',
  "skip_nonce_check = false",
];
export const CSF_DISABLED_GOOGLE_AUTH_BLOCK = [
  "[auth.external.google]",
  ...CSF_DISABLED_GOOGLE_AUTH_KEYS,
].join("\n");
const CSF_GOOGLE_AUTH_ENV_PREFIX = "SUPABASE_AUTH_EXTERNAL_GOOGLE";

// The exact label key the Supabase CLI stamps on every local resource. Both
// isolated shell scripts must use this same key for their label selectors.
export const CSF_PROJECT_LABEL_KEY = "com.supabase.cli.project";

// Pinned exact resource names for Supabase CLI 2.111.0. This is deliberately an
// explicit contract rather than a `supabase_*_<project>` glob: every name the
// pinned CLI derives goes through GetId() as `supabase_<service>_<project>`, so
// a glob would match far more than the CLI ever creates and would silently
// accept an unexpected third-party name that merely looks like ours. Only an
// explicit allowlist bounds deletion authority to resources this launcher owns.
// Both isolated shell scripts read this one contract so preflight, post-start,
// and residual checks stay identical.
// Docker namespaces names per kind, so the allowlist is typed per kind too. A
// flat list would let a *volume* named like the canonical Kong *container* pass
// the post-start ownership proof even though the CLI never creates a volume by
// that name.
const CSF_CANONICAL_DOCKER_RESOURCE_KINDS = ["container", "volume", "network"];

// Exactly what the pinned CLI's legacy shell creates, per
// apps/cli-go/internal/utils/config.go and internal/start/start.go at tag
// v2.111.0: fourteen containers named `supabase_<service>_<project>`, three named
// volumes, and one network. Nothing is listed merely because a constant exists —
// DifferId is defined at that tag but no persistent named differ container is
// created, and migra/pg_prove/test helpers run without stable names. Listing a
// name here grants it deletion authority and lets it satisfy the post-start
// ownership proof, so an overinclusive list is a safety defect, not slack.
// scripts/local-dev/pinned-supabase-cli-resources.fixture.ts is the independent
// checked-in oracle for this contract.
const CSF_CANONICAL_DOCKER_RESOURCE_PREFIXES = {
  container: [
    "supabase_db_",
    "supabase_kong_",
    "supabase_auth_",
    "supabase_inbucket_",
    "supabase_realtime_",
    "supabase_rest_",
    "supabase_storage_",
    "supabase_imgproxy_",
    "supabase_pg_meta_",
    "supabase_studio_",
    "supabase_edge_runtime_",
    "supabase_analytics_",
    "supabase_vector_",
    "supabase_pooler_",
  ],
  volume: ["supabase_db_", "supabase_storage_", "supabase_edge_runtime_"],
  network: ["supabase_network_"],
};

function assertIsolatedProjectId(projectId) {
  if (!CSF_ISOLATED_PROJECT_PATTERN.test(projectId)) {
    throw new Error(
      `Refusing canonical Docker names for a non-isolated project: ${projectId}`,
    );
  }
  return projectId;
}

/**
 * The pinned Supabase CLI 2.111.0 resource contract for one isolated project,
 * typed by Docker resource kind.
 *
 * @param {string} projectId
 */
export function csfCanonicalDockerResourceContract(projectId) {
  assertIsolatedProjectId(projectId);
  return Object.fromEntries(
    CSF_CANONICAL_DOCKER_RESOURCE_KINDS.map((kind) => [
      kind,
      CSF_CANONICAL_DOCKER_RESOURCE_PREFIXES[kind].map(
        (prefix) => `${prefix}${projectId}`,
      ),
    ]),
  );
}

/**
 * @param {string} projectId
 * @param {"container" | "volume" | "network"} kind
 */
export function csfCanonicalDockerResourceNames(projectId, kind) {
  if (!CSF_CANONICAL_DOCKER_RESOURCE_KINDS.includes(kind)) {
    throw new Error(`Unknown canonical Docker resource kind: ${kind}`);
  }
  return csfCanonicalDockerResourceContract(projectId)[kind];
}

/**
 * @param {string} projectId
 */
export function csfCanonicalDatabaseVolumeName(projectId) {
  return `supabase_db_${projectId}`;
}

// The exact grammar the launcher writes: one `export KEY='value'` per line with a
// value charset that cannot express a command substitution, expansion, or quote
// break. Anything else fails before a single byte is handed to a live command.
const CSF_APP_ENV_LINE_PATTERN =
  /^export ([A-Z][A-Z0-9_]*)='([A-Za-z0-9._:/@%+~,=-]+)'$/u;

// Exactly these keys, each exactly once. Exported so the isolated app runner and
// the cron harness build their child environments from one list rather than two
// hand-maintained copies that can drift apart.
export const CSF_APP_ENV_KEYS = [
  "API_URL",
  "ANON_KEY",
  "SERVICE_ROLE_KEY",
  "DB_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CSF_PROFILE_CLAIM_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "SITE_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "CSF_ISOLATED_WORK_DIR",
];

function parseEnvOutput(output) {
  const values = {};
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    values[key] = line.slice(separator + 1).replace(/^["']|["']$/g, "");
  }
  return values;
}

function parseSingleConfigValue(source, key) {
  // Named `[remotes.*]` blocks may intentionally repeat keys such as
  // `project_id`. Isolated-stack identity comes only from the TOML root before
  // the first section, so remote metadata must not be mistaken for a second
  // local runtime identity.
  const firstSection = source.search(/^\s*\[/mu);
  const root = firstSection === -1 ? source : source.slice(0, firstSection);
  const matches = [
    ...root.matchAll(
      new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]+)"|(\\d+))\\s*$`, "gmu"),
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${key} in the isolated Supabase config.`,
    );
  }
  return matches[0][1] ?? matches[0][2];
}

const CSF_MARKER_FIELDS = [
  "state",
  "project_id",
  "base_port",
  "work_dir",
  "db_volume",
  "db_volume_project_label",
];
const CSF_MARKER_READY_FIELDS = new Set([
  "state",
  "project_id",
  "base_port",
  "work_dir",
  "db_volume",
  "db_volume_project_label",
]);
const CSF_MARKER_TRANSITIONAL_FIELDS = new Set([
  "state",
  "project_id",
  "base_port",
  "work_dir",
]);
const CSF_MARKER_LINE_PATTERN = /^([a-z][a-z0-9_]*)=(.*)$/u;

/**
 * Exact-allowlist marker parsing: duplicate, unknown, missing, or malformed
 * fields all fail closed rather than being ignored.
 *
 * @param {string} markerSource
 * @param {{ requireState?: "ready" | "starting" }} [options]
 */
export function parseCsfIsolatedMarker(markerSource, { requireState } = {}) {
  if (!markerSource.endsWith("\n")) {
    throw new Error(
      "CSF isolated stack marker is truncated; it must end with a newline.",
    );
  }

  const values = {};
  const lines = markerSource.slice(0, -1).split("\n");
  for (const [index, line] of lines.entries()) {
    const match = CSF_MARKER_LINE_PATTERN.exec(line);
    if (!match) {
      throw new Error(
        `CSF isolated stack marker line ${index + 1} is malformed.`,
      );
    }
    const [, key, value] = match;
    if (!CSF_MARKER_FIELDS.includes(key)) {
      throw new Error(`CSF isolated stack marker has an unknown field: ${key}`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`CSF isolated stack marker repeats the field: ${key}`);
    }
    values[key] = value;
  }

  const state = values.state;
  if (state !== "ready" && state !== "starting") {
    throw new Error(
      `CSF isolated stack marker has an unknown state: ${state ?? "<missing>"}`,
    );
  }
  if (requireState && state !== requireState) {
    throw new Error(
      `CSF isolated stack marker is not ${requireState} (state=${state}).`,
    );
  }

  const expected =
    state === "ready"
      ? CSF_MARKER_READY_FIELDS
      : CSF_MARKER_TRANSITIONAL_FIELDS;
  const present = new Set(Object.keys(values));
  for (const field of expected) {
    if (!present.has(field)) {
      throw new Error(`CSF isolated stack marker is missing ${field}.`);
    }
  }
  for (const field of present) {
    if (!expected.has(field)) {
      throw new Error(
        `CSF isolated stack ${state} marker must not record ${field}.`,
      );
    }
  }

  const projectId = values.project_id;
  if (!CSF_ISOLATED_PROJECT_PATTERN.test(projectId)) {
    throw new Error("CSF isolated stack marker has an invalid project_id.");
  }
  const runId = projectId.slice(CSF_ISOLATED_PROJECT_PREFIX.length);
  if (`${CSF_ISOLATED_PROJECT_PREFIX}${runId}` !== projectId) {
    throw new Error(
      "CSF isolated stack marker project_id does not carry one run ID.",
    );
  }
  if (!/^[0-9]+$/u.test(values.base_port)) {
    throw new Error("CSF isolated stack marker has an invalid base_port.");
  }
  const basePort = Number(values.base_port);
  if (basePort < 1024 || basePort > 65526) {
    throw new Error("CSF isolated stack marker has an invalid base_port.");
  }
  if (!values.work_dir.startsWith("/")) {
    throw new Error("CSF isolated stack marker has a non-absolute work_dir.");
  }

  if (state === "starting") {
    return {
      state,
      projectId,
      runId,
      basePort,
      workDir: values.work_dir,
      databaseVolume: undefined,
      databaseVolumeLabel: undefined,
    };
  }

  if (values.db_volume !== csfCanonicalDatabaseVolumeName(projectId)) {
    throw new Error(
      "CSF isolated stack marker does not record the expected database volume identity.",
    );
  }
  if (values.db_volume_project_label !== projectId) {
    throw new Error(
      "CSF isolated stack marker database volume does not carry the exact project label.",
    );
  }

  return {
    state,
    projectId,
    runId,
    basePort,
    workDir: values.work_dir,
    databaseVolume: values.db_volume,
    databaseVolumeLabel: values.db_volume_project_label,
  };
}

// Every generated port mapping the launcher rewrites, by exact TOML section and
// key. Validating the multiset alone would accept two swapped services.
const CSF_CONFIG_PORT_MAPPING = [
  { section: "db", key: "shadow_port", offset: 0 },
  { section: "api", key: "port", offset: 1 },
  { section: "db", key: "port", offset: 2 },
  { section: "studio", key: "port", offset: 3 },
  { section: "local_smtp", key: "port", offset: 4 },
  { section: "local_smtp", key: "smtp_port", offset: 5 },
  { section: "edge_runtime", key: "inspector_port", offset: 6 },
  { section: "analytics", key: "port", offset: 7 },
  { section: "db.pooler", key: "port", offset: 9 },
];

const CSF_CONFIG_PORT_KEYS = new Set([
  "port",
  "shadow_port",
  "smtp_port",
  "inspector_port",
]);

function parseConfigPortAssignments(config) {
  const assignments = new Map();
  let section = "";
  for (const rawLine of config.split(/\r?\n/)) {
    const sectionMatch = /^\[([^\]]+)\]\s*$/u.exec(rawLine);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const keyMatch = /^[ \t]*([a-z_]+)[ \t]*=[ \t]*(\d+)[ \t]*$/u.exec(rawLine);
    if (!keyMatch || !CSF_CONFIG_PORT_KEYS.has(keyMatch[1])) continue;
    const identity = `${section}.${keyMatch[1]}`;
    const existing = assignments.get(identity) ?? [];
    existing.push(Number(keyMatch[2]));
    assignments.set(identity, existing);
  }
  return assignments;
}

function assertConfiguredPortBundle(config, basePort) {
  const assignments = parseConfigPortAssignments(config);

  for (const { section, key, offset } of CSF_CONFIG_PORT_MAPPING) {
    const identity = `${section}.${key}`;
    const values = assignments.get(identity) ?? [];
    if (values.length !== 1) {
      throw new Error(
        `CSF isolated Supabase config must declare exactly one ${identity}, found ${values.length}.`,
      );
    }
    if (values[0] !== basePort + offset) {
      throw new Error(
        `CSF isolated Supabase config ${identity} is ${values[0]}, expected ${basePort + offset}.`,
      );
    }
  }

  const mapped = new Set(
    CSF_CONFIG_PORT_MAPPING.map(({ section, key }) => `${section}.${key}`),
  );
  for (const identity of assignments.keys()) {
    if (!mapped.has(identity)) {
      throw new Error(
        `CSF isolated Supabase config declares an unmapped port assignment: ${identity}`,
      );
    }
  }

  const configured = [...assignments.values()].flat();
  const expected = CSF_ISOLATED_PORT_OFFSETS.map((offset) => basePort + offset);

  const actualSorted = [...configured].sort((a, b) => a - b);
  const expectedSorted = [...expected].sort((a, b) => a - b);
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(
      `CSF isolated Supabase config ports ${actualSorted.join(",")} do not match the marker bundle ${expectedSorted.join(",")}.`,
    );
  }
}

/**
 * The generated config must describe a runtime with no Google identity provider
 * at all, in exactly one place and in exactly one shape.
 *
 * Both halves matter. A re-enabled block is the obvious regression; a block that
 * still carries `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)` is the subtle one,
 * because it looks inert in the file and resolves to a real credential the
 * moment the CLI reads it in a shell that exports one.
 */
function assertProviderDisabledGoogleAuth(config) {
  const headers = [...config.matchAll(/^\[auth\.external\.google\][ \t]*$/gmu)];
  if (headers.length !== 1) {
    throw new Error(
      `CSF isolated Supabase config must declare exactly one [auth.external.google] section, found ${headers.length}.`,
    );
  }

  const header = headers[0];
  const remainder = config.slice(header.index + header[0].length);
  const nextSection = /^[ \t]*\[/mu.exec(remainder);
  const body = nextSection ? remainder.slice(0, nextSection.index) : remainder;
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (
    lines.length !== CSF_DISABLED_GOOGLE_AUTH_KEYS.length ||
    lines.some((line, index) => line !== CSF_DISABLED_GOOGLE_AUTH_KEYS[index])
  ) {
    throw new Error(
      "CSF isolated Supabase config [auth.external.google] is not the exact disabled shape " +
        `(${CSF_DISABLED_GOOGLE_AUTH_KEYS.join("; ")}).`,
    );
  }

  if (config.includes(CSF_GOOGLE_AUTH_ENV_PREFIX)) {
    throw new Error(
      "CSF isolated Supabase config still references an ambient " +
        `${CSF_GOOGLE_AUTH_ENV_PREFIX}_* value; a generated isolated runtime must carry no Google credential indirection.`,
    );
  }
}

// The exact, bounded key set the stop path consumes. Nothing else crosses the
// process boundary, and the consumer validates the key set before using it.
export const CSF_STACK_HANDOFF_KEYS = [
  "state",
  "project_id",
  "run_id",
  "base_port",
  "work_dir",
  "marker_path",
  "config_path",
  "db_volume",
  "db_volume_project_label",
];

function openOwnerOnlyFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  const pathPosture = lstatSync(filePath);
  assertPrivateRegularFile(filePath, pathPosture);
  // A second link to this inode would let the bytes be replaced underneath a
  // held descriptor without changing the inode.
  if (pathPosture.nlink !== 1) {
    throw new Error(
      `${label} must have exactly one hard link, found ${pathPosture.nlink}: ${filePath}`,
    );
  }

  const fd = openSync(filePath, "r");
  try {
    const opened = fstatSync(fd);
    assertPrivateRegularFile(filePath, opened);
    if (opened.dev !== pathPosture.dev || opened.ino !== pathPosture.ino) {
      throw new Error(
        `${label} changed identity between posture check and open.`,
      );
    }
    const source = readExactBytes(fd, opened.size);
    return {
      filePath,
      label,
      fd,
      posture: capturePosture(opened),
      digest: createHash("sha256").update(source).digest("hex"),
      source,
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function commitOwnerOnlyFile(handle) {
  const current = fstatSync(handle.fd);
  assertPrivateRegularFile(handle.filePath, current);
  assertUnchangedPosture(
    `${handle.label} descriptor`,
    handle.posture,
    capturePosture(current),
  );

  const source = readExactBytes(handle.fd, handle.posture.size);
  if (createHash("sha256").update(source).digest("hex") !== handle.digest) {
    throw new Error(
      `${handle.label} bytes changed between validation and handoff.`,
    );
  }

  const swapped = lstatSync(handle.filePath);
  assertPrivateRegularFile(handle.filePath, swapped);
  assertUnchangedPosture(
    `${handle.label} pathname`,
    handle.posture,
    capturePosture(swapped),
  );
  return source;
}

/**
 * Non-executing validation pass over the generated marker and Supabase config.
 * Both files are held open so the bytes that produced the handoff can never be a
 * different file than the bytes that were validated.
 *
 * @param {string} [workDirValue]
 * @param {{ requireState?: "ready" | "starting" }} [options]
 */
export function inspectCsfIsolatedStack(workDirValue, { requireState } = {}) {
  const requestedWorkDir = workDirValue?.trim();
  if (!requestedWorkDir) {
    throw new Error(
      "CSF local tooling requires CSF_ISOLATED_WORK_DIR from start-dvhs-csf-isolated-stack.sh.",
    );
  }
  if (!existsSync(requestedWorkDir)) {
    throw new Error(
      `CSF isolated work directory does not exist: ${requestedWorkDir}`,
    );
  }
  // Reject the supplied pathname itself before resolving it: a symlink would let
  // a validated marker describe a directory the caller never named.
  if (lstatSync(requestedWorkDir).isSymbolicLink()) {
    throw new Error(
      `Refusing a symlinked CSF isolated work directory: ${requestedWorkDir}`,
    );
  }

  const workDir = realpathSync(requestedWorkDir);
  const markerHandle = openOwnerOnlyFile(
    path.join(workDir, CSF_ISOLATED_MARKER),
    "CSF isolated stack marker",
  );
  let configHandle;
  try {
    configHandle = openOwnerOnlyFile(
      path.join(workDir, "supabase", "config.toml"),
      "CSF isolated Supabase config",
    );
  } catch (error) {
    closeSync(markerHandle.fd);
    throw error;
  }

  try {
    const values = validateCsfIsolatedStackSources(
      workDir,
      markerHandle.source,
      configHandle.source,
      { requireState },
    );
    return { workDir, markerHandle, configHandle, values };
  } catch (error) {
    closeSync(markerHandle.fd);
    closeSync(configHandle.fd);
    throw error;
  }
}

function validateCsfIsolatedStackSources(
  workDir,
  markerSource,
  configSource,
  { requireState },
) {
  const marker = parseCsfIsolatedMarker(markerSource, { requireState });

  const configProjectId = parseSingleConfigValue(configSource, "project_id");
  if (configProjectId !== marker.projectId) {
    throw new Error(
      "CSF isolated stack marker does not match the Supabase project_id.",
    );
  }
  // Every configured port mapping, not only the API and database ones.
  assertConfiguredPortBundle(configSource, marker.basePort);
  // And no identity provider, in the same non-executing pass.
  assertProviderDisabledGoogleAuth(configSource);

  // A marker copied next to another stack's config cannot describe this one.
  if (!existsSync(marker.workDir)) {
    throw new Error(
      "CSF isolated stack marker records a work_dir that does not exist.",
    );
  }
  if (realpathSync(marker.workDir) !== workDir) {
    throw new Error(
      "CSF isolated stack marker work_dir does not match the directory it was found in.",
    );
  }

  if (marker.state === "ready") {
    const expectedVolume = csfCanonicalDatabaseVolumeName(marker.projectId);
    const volumes = csfCanonicalDockerResourceNames(marker.projectId, "volume");
    if (
      !volumes.includes(expectedVolume) ||
      marker.databaseVolume !== expectedVolume
    ) {
      throw new Error(
        "CSF isolated stack marker does not record the canonical database volume for the volume kind.",
      );
    }
  }

  return {
    state: marker.state,
    project_id: marker.projectId,
    run_id: marker.runId,
    base_port: String(marker.basePort),
    work_dir: workDir,
    marker_path: path.join(workDir, CSF_ISOLATED_MARKER),
    config_path: path.join(workDir, "supabase", "config.toml"),
    db_volume: marker.databaseVolume ?? "",
    db_volume_project_label: marker.databaseVolumeLabel ?? "",
  };
}

/**
 * Handoff pass. Re-reads both held descriptors, rechecks their posture and
 * digests, re-validates, and compares every emitted value before returning the
 * bounded record.
 *
 * @param {ReturnType<typeof inspectCsfIsolatedStack>} inspection
 */
export function commitCsfIsolatedStack(inspection) {
  try {
    const markerSource = commitOwnerOnlyFile(inspection.markerHandle);
    const configSource = commitOwnerOnlyFile(inspection.configHandle);
    const reloaded = validateCsfIsolatedStackSources(
      inspection.workDir,
      markerSource,
      configSource,
      { requireState: inspection.values.state },
    );
    for (const key of CSF_STACK_HANDOFF_KEYS) {
      if (reloaded[key] !== inspection.values[key]) {
        throw new Error(
          `CSF isolated stack ${key} does not match its validated value.`,
        );
      }
    }
    return reloaded;
  } finally {
    closeSync(inspection.markerHandle.fd);
    closeSync(inspection.configHandle.fd);
  }
}

/**
 * @param {string} [workDirValue]
 * @param {{ requireState?: "ready" | "starting" }} [options]
 */
export function validateCsfIsolatedStack(workDirValue, options) {
  return commitCsfIsolatedStack(inspectCsfIsolatedStack(workDirValue, options));
}

export function inspectCsfIsolatedWorkDir(workDirValue) {
  const validated = validateCsfIsolatedStack(workDirValue, {
    requireState: "ready",
  });
  const basePort = Number(validated.base_port);

  return {
    workDir: validated.work_dir,
    projectId: validated.project_id,
    runId: validated.run_id,
    basePort,
    databaseVolume: validated.db_volume,
    apiPort: basePort + 1,
    databasePort: basePort + 2,
    // Mailpit's SMTP listener, derived from the same validated bundle offset the
    // generated config was checked against.
    smtpPort: basePort + 5,
  };
}

function assertPrivateRegularFile(target, stats, { exactMode } = {}) {
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing a symlinked CSF isolated file: ${target}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing a non-regular CSF isolated file: ${target}`);
  }
  if (exactMode !== undefined && (stats.mode & 0o777) !== exactMode) {
    throw new Error(
      `CSF isolated file ${target} must be mode ${exactMode.toString(8)}, found ${(stats.mode & 0o777).toString(8)}.`,
    );
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(
      `Refusing a group/world-accessible CSF isolated file: ${target}`,
    );
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(
      `Refusing a CSF isolated file owned by another user: ${target}`,
    );
  }
}

function parseCsfAppEnvironment(source, isolated) {
  if (!source.endsWith("\n")) {
    throw new Error(
      "CSF isolated app environment must end with a newline; refusing a truncated file.",
    );
  }

  const values = {};
  const lines = source.slice(0, -1).split("\n");
  for (const [index, line] of lines.entries()) {
    const match = CSF_APP_ENV_LINE_PATTERN.exec(line);
    if (!match) {
      throw new Error(
        `CSF isolated app environment line ${index + 1} is not an allowlisted single-quoted export.`,
      );
    }
    const [, key, value] = match;
    if (!CSF_APP_ENV_KEYS.includes(key)) {
      throw new Error(
        `CSF isolated app environment exports an unknown key: ${key}`,
      );
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(
        `CSF isolated app environment exports ${key} more than once.`,
      );
    }
    values[key] = value;
  }

  const missing = CSF_APP_ENV_KEYS.filter((key) => !Object.hasOwn(values, key));
  if (missing.length > 0) {
    throw new Error(
      `CSF isolated app environment is missing ${missing.join(", ")}.`,
    );
  }

  assertCsfAppEnvironmentAgrees(values, isolated);
  return values;
}

function assertCsfAppEnvironmentAgrees(values, isolated) {
  const sameValue = (keys, label) => {
    const [first, ...rest] = keys;
    for (const key of rest) {
      if (values[key] !== values[first]) {
        throw new Error(
          `CSF isolated app environment ${label} disagree between ${first} and ${key}.`,
        );
      }
    }
    return values[first];
  };

  const apiUrl = sameValue(
    ["API_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
    "API endpoints",
  );
  const databaseUrl = sameValue(
    ["DB_URL", "SUPABASE_DB_URL"],
    "database endpoints",
  );
  sameValue(
    ["ANON_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    "anonymous keys",
  );
  sameValue(
    ["SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    "service-role keys",
  );
  const siteUrl = sameValue(["NEXT_PUBLIC_SITE_URL", "SITE_URL"], "site URLs");
  // Exact values, not mutual agreement: two matching but wrong origins would
  // otherwise point the whole gate at another app.
  if (siteUrl !== CSF_ISOLATED_SITE_URL) {
    throw new Error(
      `CSF isolated app environment site URL must be exactly ${CSF_ISOLATED_SITE_URL}.`,
    );
  }
  if (values.NEXT_PUBLIC_VERCEL_URL !== CSF_ISOLATED_VERCEL_URL) {
    throw new Error(
      `CSF isolated app environment NEXT_PUBLIC_VERCEL_URL must be exactly ${CSF_ISOLATED_VERCEL_URL}.`,
    );
  }

  const api = new URL(assertLocalSupabaseUrl(apiUrl));
  const database = new URL(assertLocalPostgresUrl(databaseUrl));
  if (Number(api.port) !== isolated.apiPort) {
    throw new Error(
      `CSF isolated app environment API port ${api.port} does not match the marker's ${isolated.apiPort}.`,
    );
  }
  if (Number(database.port) !== isolated.databasePort) {
    throw new Error(
      `CSF isolated app environment database port ${database.port} does not match the marker's ${isolated.databasePort}.`,
    );
  }
  if (new URL(siteUrl).host !== values.NEXT_PUBLIC_VERCEL_URL) {
    throw new Error(
      "CSF isolated app environment NEXT_PUBLIC_VERCEL_URL does not match its site URL host.",
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(values.CSF_PROFILE_CLAIM_SECRET)) {
    throw new Error(
      "CSF isolated app environment profile-claim secret is not a generated 32-byte hex value.",
    );
  }
  if (!existsSync(values.CSF_ISOLATED_WORK_DIR)) {
    throw new Error(
      "CSF isolated app environment points at a work directory that does not exist.",
    );
  }
  if (realpathSync(values.CSF_ISOLATED_WORK_DIR) !== isolated.workDir) {
    throw new Error(
      "CSF isolated app environment work directory does not match the validated marker.",
    );
  }
}

/**
 * Non-executing validation pass. Opens the generated app environment once and
 * keeps that descriptor so the bytes handed to the caller can never be a
 * different file than the bytes that were validated.
 *
 * @param {string} [workDirValue]
 */
export function inspectCsfIsolatedAppEnvironment(workDirValue) {
  const isolated = inspectCsfIsolatedWorkDir(workDirValue);
  const appEnvPath = path.join(isolated.workDir, CSF_ISOLATED_APP_ENV_FILE);
  if (!existsSync(appEnvPath)) {
    throw new Error(
      `Missing generated isolated app environment: ${appEnvPath}`,
    );
  }
  const pathPosture = lstatSync(appEnvPath);
  assertPrivateRegularFile(appEnvPath, pathPosture, { exactMode: 0o600 });
  // A second name for this inode means the bytes can be replaced underneath a
  // held descriptor without changing the inode, so require a sole link.
  if (pathPosture.nlink !== 1) {
    throw new Error(
      `CSF isolated app environment must have exactly one hard link, found ${pathPosture.nlink}.`,
    );
  }

  const fd = openSync(appEnvPath, "r");
  try {
    const opened = fstatSync(fd);
    assertPrivateRegularFile(appEnvPath, opened, { exactMode: 0o600 });
    if (opened.dev !== pathPosture.dev || opened.ino !== pathPosture.ino) {
      throw new Error(
        "CSF isolated app environment changed identity between posture check and open.",
      );
    }
    const source = readExactBytes(fd, opened.size);
    const values = parseCsfAppEnvironment(source, isolated);
    return {
      isolated,
      appEnvPath,
      fd,
      posture: capturePosture(opened),
      digest: createHash("sha256").update(source).digest("hex"),
      values,
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

// Identity metadata compared byte-for-byte before handoff. `nlink` and `ctimeMs`
// are what catch a hardlink replacement, which keeps the inode identical.
function capturePosture(stats) {
  return {
    dev: stats.dev,
    ino: stats.ino,
    nlink: stats.nlink,
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}

function assertUnchangedPosture(label, expected, actual) {
  for (const field of Object.keys(expected)) {
    if (expected[field] !== actual[field]) {
      throw new Error(
        `CSF isolated app environment ${label} changed (${field}) between validation and handoff.`,
      );
    }
  }
}

function readExactBytes(fd, size) {
  const buffer = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const chunk = readSync(fd, buffer, read, size - read, read);
    if (chunk === 0) break;
    read += chunk;
  }
  if (read !== size) {
    throw new Error(
      "CSF isolated app environment shrank while it was being read.",
    );
  }
  return buffer.toString("utf8");
}

/**
 * Handoff pass. Re-reads the held descriptor — never the pathname — rechecks
 * inode/size/digest, and compares every reloaded value with the non-executing
 * parser's value before anything live runs.
 *
 * @param {ReturnType<typeof inspectCsfIsolatedAppEnvironment>} inspection
 */
export function commitCsfIsolatedAppEnvironment(inspection) {
  try {
    const current = fstatSync(inspection.fd);
    assertPrivateRegularFile(inspection.appEnvPath, current, {
      exactMode: 0o600,
    });
    assertUnchangedPosture(
      "descriptor",
      inspection.posture,
      capturePosture(current),
    );

    const source = readExactBytes(inspection.fd, inspection.posture.size);
    if (
      createHash("sha256").update(source).digest("hex") !== inspection.digest
    ) {
      throw new Error(
        "CSF isolated app environment bytes changed between validation and handoff.",
      );
    }

    // A rename over the pathname leaves this descriptor pointing at the old
    // inode, so compare the path's full identity too. Comparing the whole
    // posture — not just dev/ino — is what catches a hardlink replacement that
    // reuses the same inode.
    const swapped = lstatSync(inspection.appEnvPath);
    assertPrivateRegularFile(inspection.appEnvPath, swapped, {
      exactMode: 0o600,
    });
    assertUnchangedPosture(
      "pathname",
      inspection.posture,
      capturePosture(swapped),
    );

    const reloaded = parseCsfAppEnvironment(source, inspection.isolated);
    for (const key of CSF_APP_ENV_KEYS) {
      if (reloaded[key] !== inspection.values[key]) {
        throw new Error(
          `CSF isolated app environment ${key} does not match its validated value.`,
        );
      }
    }
    return reloaded;
  } finally {
    closeSync(inspection.fd);
  }
}

/**
 * @param {string} [workDirValue]
 */
export function loadCsfIsolatedAppEnvironment(workDirValue) {
  return commitCsfIsolatedAppEnvironment(
    inspectCsfIsolatedAppEnvironment(workDirValue),
  );
}

export function assertLocalSupabaseUrl(value) {
  const url = new URL(value);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `DV local tooling refuses non-local Supabase URL: ${url.origin}`,
    );
  }
  return url.origin;
}

export function assertLocalPostgresUrl(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(
      `Local Supabase tooling requires a Postgres URL, received: ${url.protocol}`,
    );
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Local Supabase tooling refuses non-local Postgres URL: ${url.hostname}`,
    );
  }
  return value;
}

function hasProvidedValue(env, keys) {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function firstProvidedValue(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function assertCompleteBundle(label, values) {
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `${label} Supabase environment is incomplete; missing ${missing.join(", ")}. ` +
        "Refusing to combine it with another environment source.",
    );
  }
}

function normalizeLoopbackHost(hostname) {
  return LOCAL_HOSTS.has(hostname) ? "loopback" : hostname;
}

function assertCoherentLocalSupabaseBundle(rawUrl, dbUrl) {
  const api = new URL(rawUrl);
  const database = new URL(dbUrl);
  const apiPort = Number(api.port);
  const databasePort = Number(database.port);

  if (
    normalizeLoopbackHost(api.hostname) !==
    normalizeLoopbackHost(database.hostname)
  ) {
    throw new Error(
      "Local Supabase API and database URLs must use the same loopback host.",
    );
  }

  if (
    !Number.isInteger(apiPort) ||
    !Number.isInteger(databasePort) ||
    apiPort <= 0 ||
    databasePort !== apiPort + 1
  ) {
    throw new Error(
      "Local Supabase database port must be exactly one greater than the API port.",
    );
  }
}

function normalizedLoopbackEndpoint(value) {
  const url = new URL(value);
  return `${url.protocol}//loopback:${url.port}`;
}

function assertBundleMatchesStatus(provided, statusValues, label) {
  const status = resolveProvidedLocalSupabaseEnv(statusValues);
  if (!status) {
    throw new Error(
      `${label} Supabase status did not return a complete environment bundle.`,
    );
  }

  if (
    normalizedLoopbackEndpoint(provided.url) !==
      normalizedLoopbackEndpoint(status.url) ||
    normalizedLoopbackEndpoint(provided.dbUrl) !==
      normalizedLoopbackEndpoint(status.dbUrl)
  ) {
    throw new Error(
      `${label} environment does not match the selected Let’s Assist Supabase stack. Refusing an ambient Vela or mixed-stack connection.`,
    );
  }

  const allowedAnonKeys = new Set(
    [statusValues.ANON_KEY, statusValues.PUBLISHABLE_KEY].filter(Boolean),
  );
  const allowedServiceKeys = new Set(
    [statusValues.SERVICE_ROLE_KEY, statusValues.SECRET_KEY].filter(Boolean),
  );
  if (
    !allowedAnonKeys.has(provided.anonKey) ||
    !allowedServiceKeys.has(provided.serviceRoleKey)
  ) {
    throw new Error(
      `${label} credentials do not belong to the selected Let’s Assist Supabase stack.`,
    );
  }
}

export function assertProvidedLocalSupabaseEnvMatchesStatus(
  providedEnvironment,
  statusValues,
  label = "Let’s Assist local",
) {
  const provided = resolveProvidedLocalSupabaseEnv(providedEnvironment);
  if (!provided) {
    throw new Error(
      `${label} environment did not provide a complete Supabase bundle.`,
    );
  }
  assertBundleMatchesStatus(provided, statusValues, label);
  return provided;
}

function readLocalSupabaseStatus(workDir) {
  const args = ["status", "-o", "env"];
  if (workDir) args.push("--workdir", workDir);
  const output = execFileSync("supabase", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (/Stopped services:/i.test(output)) {
    throw new Error(
      "Selected Let’s Assist Supabase stack is stopped. Start it before running local tooling.",
    );
  }
  return parseEnvOutput(output);
}

function getValidatedLocalSupabaseEnv(
  env,
  { requireCsfIsolated = false } = {},
) {
  const isolated = env.CSF_ISOLATED_WORK_DIR
    ? inspectCsfIsolatedWorkDir(env.CSF_ISOLATED_WORK_DIR)
    : null;
  if (requireCsfIsolated && !isolated) {
    throw new Error(
      "CSF service-role tooling requires an explicit generated CSF isolated stack.",
    );
  }

  const statusValues = readLocalSupabaseStatus(isolated?.workDir);
  const status = resolveProvidedLocalSupabaseEnv(statusValues);
  if (!status) {
    throw new Error(
      "Local Supabase status did not return a complete environment bundle.",
    );
  }
  const provided = resolveProvidedLocalSupabaseEnv(env);
  if (provided) {
    return assertProvidedLocalSupabaseEnvMatchesStatus(
      env,
      statusValues,
      isolated
        ? `CSF isolated project ${isolated.projectId}`
        : "Let’s Assist local",
    );
  }
  return status;
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveProvidedLocalSupabaseEnv(env = process.env) {
  const hasExplicitBundle = hasProvidedValue(env, EXPLICIT_SUPABASE_ENV_KEYS);
  const hasGenericBundle = hasProvidedValue(env, GENERIC_SUPABASE_ENV_KEYS);

  if (!hasExplicitBundle && !hasGenericBundle) return null;

  const values = hasExplicitBundle
    ? {
        rawUrl: firstProvidedValue(env, [
          "NEXT_PUBLIC_SUPABASE_URL",
          "SUPABASE_URL",
        ]),
        anonKey: firstProvidedValue(env, [
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "SUPABASE_ANON_KEY",
        ]),
        serviceRoleKey: firstProvidedValue(env, [
          "SUPABASE_SECRET_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
        ]),
        dbUrl: firstProvidedValue(env, ["SUPABASE_DB_URL"]),
      }
    : {
        rawUrl: firstProvidedValue(env, ["API_URL"]),
        anonKey: firstProvidedValue(env, ["ANON_KEY"]),
        serviceRoleKey: firstProvidedValue(env, ["SERVICE_ROLE_KEY"]),
        dbUrl: firstProvidedValue(env, ["DB_URL"]),
      };

  assertCompleteBundle(
    hasExplicitBundle ? "Explicit Let’s Assist" : "Generic local",
    values,
  );
  const url = assertLocalSupabaseUrl(values.rawUrl);
  const dbUrl = assertLocalPostgresUrl(values.dbUrl);
  assertCoherentLocalSupabaseBundle(url, dbUrl);

  return {
    url,
    serviceRoleKey: values.serviceRoleKey,
    anonKey: values.anonKey,
    dbUrl,
  };
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function getLocalSupabaseEnv(env = process.env) {
  return getValidatedLocalSupabaseEnv(env);
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function getCsfIsolatedSupabaseEnv(env = process.env) {
  return getValidatedLocalSupabaseEnv(env, { requireCsfIsolated: true });
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function getLocalSupabaseDbUrl(env = process.env) {
  return getValidatedLocalSupabaseEnv(env).dbUrl;
}

const CLI_MODES = [
  "--health",
  "--csf-health",
  "--validate-app-env",
  "--print-app-env",
  "--canonical-docker-names",
  "--validate-stack-target",
  "--db-url",
];

// Compare resolved paths: an invocation through a symlinked prefix (macOS
// /tmp -> /private/tmp, a symlinked checkout) is still this file being run
// directly, and must not trip the fail-closed guard below.
function isSamePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return left === right;
  }
}

const isEntrypoint = process.argv[1]
  ? isSamePath(fileURLToPath(import.meta.url), process.argv[1])
  : false;
const requestedModes = process.argv
  .slice(2)
  .filter((argument) => CLI_MODES.includes(argument));

// Fail closed rather than silently succeeding: a mode flag that reaches an
// imported copy of this module would otherwise look like a passing gate.
if (requestedModes.length > 0 && !isEntrypoint) {
  throw new Error(
    "dv-local-env.mjs modes require running this file directly, not importing it.",
  );
}
if (requestedModes.length > 1) {
  throw new Error(
    `Provide exactly one dv-local-env.mjs mode, received: ${requestedModes.join(", ")}`,
  );
}

if (isEntrypoint) {
  const [mode = "--env"] = requestedModes;
  switch (mode) {
    case "--health": {
      console.log(JSON.stringify({ ok: true, url: getLocalSupabaseEnv().url }));
      break;
    }
    case "--csf-health": {
      // Live status/credential validation bound to the exact generated target,
      // asserted against the launcher's marker, project, base port, and volume.
      const isolated = inspectCsfIsolatedWorkDir(
        process.env.CSF_ISOLATED_WORK_DIR,
      );
      const env = getCsfIsolatedSupabaseEnv();
      console.log(
        JSON.stringify({
          ok: true,
          url: env.url,
          projectId: isolated.projectId,
          basePort: isolated.basePort,
          apiPort: isolated.apiPort,
          databasePort: isolated.databasePort,
          databaseVolume: isolated.databaseVolume,
        }),
      );
      break;
    }
    case "--validate-app-env": {
      // Non-executing validation and exact-byte handoff, without emitting any
      // credential. No live command runs in this mode.
      const inspection = inspectCsfIsolatedAppEnvironment(
        process.env.CSF_ISOLATED_WORK_DIR,
      );
      commitCsfIsolatedAppEnvironment(inspection);
      console.log(
        JSON.stringify({
          ok: true,
          projectId: inspection.isolated.projectId,
          basePort: inspection.isolated.basePort,
          databaseVolume: inspection.isolated.databaseVolume,
          appEnvPath: inspection.appEnvPath,
          exportedKeys: CSF_APP_ENV_KEYS.length,
        }),
      );
      break;
    }
    case "--print-app-env": {
      // Same contract, then emit only the already-validated values so the caller
      // never executes or re-opens the generated file.
      const values = loadCsfIsolatedAppEnvironment(
        process.env.CSF_ISOLATED_WORK_DIR,
      );
      process.stdout.write(
        `${CSF_APP_ENV_KEYS.map((key) => `${key}=${values[key]}`).join("\n")}\n`,
      );
      break;
    }
    case "--canonical-docker-names": {
      // One pinned, kind-typed source of truth for the launcher and the stop
      // script, so preflight, post-start, and residual checks compare identical
      // names for the exact resource kind being enumerated.
      const flagIndex = process.argv.indexOf(mode);
      const kind = process.argv[flagIndex + 1];
      const projectId = process.argv[flagIndex + 2];
      if (!kind || !projectId) {
        throw new Error(
          "--canonical-docker-names requires a resource kind and an isolated project ID.",
        );
      }
      process.stdout.write(
        `${csfCanonicalDockerResourceNames(projectId, kind).join("\n")}\n`,
      );
      break;
    }
    case "--validate-stack-target": {
      // Non-executing marker/config validation with an exact-byte handoff. The
      // consumer never evals or sources these bytes.
      const requestedState = process.argv[process.argv.indexOf(mode) + 1];
      const validated = validateCsfIsolatedStack(
        process.env.CSF_ISOLATED_WORK_DIR,
        requestedState ? { requireState: requestedState } : undefined,
      );
      process.stdout.write(
        `${CSF_STACK_HANDOFF_KEYS.map((key) => `${key}=${validated[key]}`).join("\n")}\n`,
      );
      break;
    }
    case "--db-url": {
      console.log(getLocalSupabaseDbUrl());
      break;
    }
    default: {
      console.log(JSON.stringify(getLocalSupabaseEnv()));
      break;
    }
  }
}
