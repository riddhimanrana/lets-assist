import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const OPERATION = "troop941-project-organization-association-v1";

function uuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value))
    throw new Error(`Invalid ${label}`);
  return value.toLowerCase();
}
function keys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !expected.includes(key))
  )
    throw new Error(`Invalid ${label}`);
}
export function validateAssociationInput(
  input,
  { requireFingerprint = false } = {},
) {
  keys(
    input,
    ["requestId", "actorId", "targetOrganization", "projects"],
    "operation input",
  );
  keys(input.targetOrganization, ["id", "username"], "target organization");
  if (input.targetOrganization.username !== "troop941")
    throw new Error("This operation is restricted to troop941");
  if (!Array.isArray(input.projects) || input.projects.length !== 2)
    throw new Error("Exactly two reviewed projects are required");
  const projects = input.projects
    .map((project) => {
      keys(
        project,
        [
          "id",
          "expectedCreatorId",
          "expectedOrganizationId",
          "expectedFingerprint",
          "expectedCounts",
        ],
        "project",
      );
      if (project.expectedOrganizationId !== null)
        throw new Error("The reviewed source organization must be null");
      const fingerprint = project.expectedFingerprint ?? null;
      if (
        (fingerprint !== null &&
          (typeof fingerprint !== "string" || !SHA256.test(fingerprint))) ||
        (requireFingerprint && fingerprint === null)
      )
        throw new Error(
          "A reviewed SHA-256 fingerprint is required before apply",
        );
      keys(
        project.expectedCounts,
        ["signups", "certificates"],
        "expected counts",
      );
      for (const count of [
        project.expectedCounts.signups,
        project.expectedCounts.certificates,
      ]) {
        if (!Number.isSafeInteger(count) || count < 0)
          throw new Error("Expected counts must be nonnegative integers");
      }
      return {
        id: uuid(project.id, "project id"),
        expectedCreatorId: uuid(project.expectedCreatorId, "creator id"),
        expectedOrganizationId: null,
        expectedFingerprint: fingerprint,
        expectedCounts: {
          signups: project.expectedCounts.signups,
          certificates: project.expectedCounts.certificates,
        },
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (projects[0].id === projects[1].id)
    throw new Error("Project ids must be distinct");
  return {
    requestId: uuid(input.requestId, "request id"),
    actorId: uuid(input.actorId, "actor id"),
    targetOrganization: {
      id: uuid(input.targetOrganization.id, "organization id"),
      username: "troop941",
    },
    projects,
  };
}
export function associationOperationFingerprint(input) {
  return createHash("sha256")
    .update(JSON.stringify(validateAssociationInput(input)))
    .digest("hex");
}
function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

// Hash complete rows. Creator, schedule, publish state, waiver settings, attendance,
// identity fields, and certificate contents stay in the protected snapshot.
function inspectionSelect(configSql) {
  return `SELECT coalesce(jsonb_agg(jsonb_build_object(
    'projectId', p.id, 'creatorId', p.creator_id, 'organizationId', p.organization_id,
    'fingerprint', encode(extensions.digest(convert_to(jsonb_build_object(
      'project', to_jsonb(p) - 'organization_id' - 'updated_at',
      'signups', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb) FROM public.project_signups s WHERE s.project_id = p.id),
      'certificates', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb) FROM public.certificates c WHERE c.project_id = p.id),
      'anonymousSignups', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb) FROM public.anonymous_signups a WHERE a.project_id = p.id),
      'waiverSignatures', (SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id), '[]'::jsonb) FROM public.waiver_signatures w WHERE w.project_id = p.id)
    )::text, 'UTF8'), 'sha256'), 'hex'),
    'counts', jsonb_build_object(
      'signups', (SELECT count(*) FROM public.project_signups s WHERE s.project_id = p.id),
      'certificates', (SELECT count(*) FROM public.certificates c WHERE c.project_id = p.id)
    )
  ) ORDER BY p.id), '[]'::jsonb)
  FROM public.projects p
  WHERE p.id IN (SELECT (entry->>'id')::uuid FROM jsonb_array_elements(${configSql}->'projects') entry)`;
}

export function buildAssociationInspectionSql(input) {
  const config = validateAssociationInput(input);
  return `-- Read-only inspection. Output contains identifiers, counts, and hashes only.
WITH config AS (SELECT ${sqlString(JSON.stringify(config))}::jsonb AS value)
SELECT jsonb_build_object(
  'operation', '${OPERATION}',
  'requestId', config.value->>'requestId',
  'operationFingerprint', '${associationOperationFingerprint(config)}',
  'mode', 'inspection',
  'applySupported', false,
  'tenantConstraint', (SELECT jsonb_build_object('name', conname, 'deferrable', condeferrable, 'definition', pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid = 'public.project_signups'::regclass AND conname = 'project_signups_project_tenant_fkey'),
  'targetAuthorized', EXISTS (
    SELECT 1 FROM public.organizations o JOIN public.organization_members m ON m.organization_id = o.id
    WHERE o.id = (config.value->'targetOrganization'->>'id')::uuid AND o.username = 'troop941' AND o.verified IS TRUE
      AND m.user_id = (config.value->>'actorId')::uuid AND m.role = 'admin' AND m.status = 'active'
  ),
  'projects', (${inspectionSelect("config.value")})
) AS result FROM config;\n`;
}

export const ASSOCIATION_APPLY_BLOCKER =
  "Association apply is blocked by project_signups_project_tenant_fkey. Changing a project's organization changes its generated cancellation_tenant_id and requires a separately reviewed schema and reassignment workflow. No apply SQL was generated.";

export function buildAssociationApplySql(input) {
  validateAssociationInput(input, { requireFingerprint: true });
  throw new Error(ASSOCIATION_APPLY_BLOCKER);
}

export function validateAssociationResult(input, result) {
  const config = validateAssociationInput(input, { requireFingerprint: true });
  if (
    !result ||
    result.operation !== OPERATION ||
    result.requestId !== config.requestId ||
    result.operationFingerprint !== associationOperationFingerprint(config) ||
    !["apply", "inspection"].includes(result.mode) ||
    result.targetAuthorized !== true ||
    !Array.isArray(result.projects) ||
    result.projects.length !== 2
  )
    throw new Error("Result is not bound to this reviewed operation");
  for (const expected of config.projects) {
    const matching = result.projects.filter(
      (project) => project.projectId === expected.id,
    );
    const project = matching[0];
    if (
      matching.length !== 1 ||
      project.creatorId !== expected.expectedCreatorId ||
      project.organizationId !== config.targetOrganization.id ||
      project.fingerprint !== expected.expectedFingerprint ||
      project.counts?.signups !== expected.expectedCounts.signups ||
      project.counts?.certificates !== expected.expectedCounts.certificates
    )
      throw new Error("Result does not prove the protected project state");
  }
  const before =
    result.mode === "apply"
      ? result.before
      : config.projects.map((project) => ({
          projectId: project.id,
          creatorId: project.expectedCreatorId,
          organizationId: null,
          fingerprint: project.expectedFingerprint,
          counts: project.expectedCounts,
        }));
  if (!Array.isArray(before) || before.length !== 2)
    throw new Error("Missing before-state proof");
  for (const expected of config.projects) {
    const matches = before.filter(
      (project) => project.projectId === expected.id,
    );
    const row = matches[0];
    if (
      matches.length !== 1 ||
      row.creatorId !== expected.expectedCreatorId ||
      ![null, config.targetOrganization.id].includes(row.organizationId) ||
      row.fingerprint !== expected.expectedFingerprint ||
      row.counts?.signups !== expected.expectedCounts.signups ||
      row.counts?.certificates !== expected.expectedCounts.certificates
    )
      throw new Error("Invalid before-state proof");
  }
  if (
    result.mode === "apply" &&
    (result.changedCount !==
      before.filter((project) => project.organizationId === null).length ||
      result.status !==
        (result.changedCount === 0 ? "already_associated" : "applied"))
  )
    throw new Error("Invalid apply outcome");
  return {
    operation: OPERATION,
    requestId: config.requestId,
    operationFingerprint: associationOperationFingerprint(config),
    before: before.map((project) => ({
      projectId: project.projectId,
      creatorId: project.creatorId,
      organizationId: project.organizationId,
      fingerprint: project.fingerprint,
      counts: {
        signups: project.counts.signups,
        certificates: project.counts.certificates,
      },
    })),
    status:
      result.mode === "inspection" ? "reconciled_target" : "verified_target",
    recordedAt: new Date().toISOString(),
    projects: result.projects.map((project) => ({
      projectId: project.projectId,
      creatorId: project.creatorId,
      organizationId: project.organizationId,
      fingerprint: project.fingerprint,
      counts: {
        signups: project.counts.signups,
        certificates: project.counts.certificates,
      },
    })),
  };
}

function protectedDirectory(root, requestId) {
  const segments = [
    ".artifacts",
    "operations",
    "project-organization-association",
    requestId,
  ];
  let current = resolve(root);
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("Receipt directory must not contain symlinks");
    if (segment === requestId && (stat.mode & 0o077) !== 0)
      throw new Error("Receipt directory must be owner-only");
  }
  return current;
}
export function prepareAssociationArtifacts(
  input,
  { root = process.cwd(), mode = "inspect" } = {},
) {
  if (!["inspect", "prepare-apply", "reconcile"].includes(mode))
    throw new Error("Invalid preparation mode");
  const config = validateAssociationInput(input, {
    requireFingerprint: mode !== "inspect",
  });
  const directory = protectedDirectory(root, config.requestId);
  const applyPath = resolve(directory, "apply.sql");
  if (mode === "prepare-apply" && existsSync(applyPath))
    throw new Error(
      "Apply was already prepared. Reconcile read-only after any possible submission; never blindly retry",
    );
  const name =
    mode === "prepare-apply" ? "apply.sql" : `${mode}-${randomUUID()}.sql`;
  const path = resolve(directory, name);
  const sql =
    mode === "prepare-apply"
      ? buildAssociationApplySql(config)
      : buildAssociationInspectionSql(config);
  writeFileSync(path, sql, { mode: 0o600, flag: "wx" });
  if (mode === "prepare-apply")
    writeFileSync(
      resolve(directory, "prepared.json"),
      `${JSON.stringify({ operation: OPERATION, requestId: config.requestId, operationFingerprint: associationOperationFingerprint(config), status: "prepared_requires_reconciliation_after_submission", preparedAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  return path;
}
export function recordAssociationResult(
  input,
  result,
  { root = process.cwd() } = {},
) {
  const receipt = validateAssociationResult(input, result);
  const directory = protectedDirectory(root, receipt.requestId);
  const path = resolve(directory, `receipt-${randomUUID()}.json`);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  return path;
}

function readIgnoredJson(path, root) {
  const absolute = resolve(root, path);
  const local = relative(resolve(root, ".artifacts"), absolute);
  if (!local || local.startsWith("..") || isAbsolute(local))
    throw new Error(
      "Operational input and readback files must stay under ignored .artifacts",
    );
  for (
    let current = absolute;
    current !== resolve(root);
    current = dirname(current)
  ) {
    if (lstatSync(current).isSymbolicLink())
      throw new Error("Operational files must not use symlinks");
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0)
    throw new Error("Operational JSON files must be owner-only regular files");
  return JSON.parse(readFileSync(absolute, "utf8"));
}
export function main(args = process.argv.slice(2), root = process.cwd()) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (
      !["--input", "--mode", "--result"].includes(key) ||
      !args[index + 1] ||
      options[key]
    )
      throw new Error(
        "Usage: --input .artifacts/input.json [--mode inspect|prepare-apply|reconcile|record-result] [--result .artifacts/result.json]",
      );
    options[key] = args[index + 1];
  }
  if (!options["--input"])
    throw new Error("An explicit reviewed input file is required");
  const input = readIgnoredJson(options["--input"], root);
  const mode = options["--mode"] ?? "inspect";
  if (mode === "record-result") {
    if (!options["--result"])
      throw new Error("Readback result file is required");
    return recordAssociationResult(
      input,
      readIgnoredJson(options["--result"], root),
      { root },
    );
  }
  if (options["--result"])
    throw new Error("Result is only valid for record-result");
  return prepareAssociationArtifacts(input, { root, mode });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(main());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
