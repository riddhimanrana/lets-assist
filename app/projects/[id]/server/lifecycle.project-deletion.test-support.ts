/**
 * A fictional, in-memory stand-in for the database side of the project asset
 * lifecycle, used only by lifecycle.project-deletion.test.ts. It holds no test
 * cases and reaches no provider.
 *
 * The model follows migration 20261011112500 rule for rule: the object
 * registry, the reference fence, the deletion claim, the Storage delete guard
 * and the two RPCs. It is one JavaScript thread, so it shows what the action
 * does with each outcome. It does not prove the SQL, its locks, or what two
 * concurrent transactions do; the pgTAP file and the isolated replay do that.
 */

import {
  linkedObject,
  nameProject,
} from "./lifecycle.project-asset-link.test-support";

export type Row = Record<string, unknown>;
export type Failure = { code: string; message: string };
export type Bucket = "project-images" | "project-documents";
type Registered = {
  bucket: Bucket;
  name: string;
  objectId: string;
  ownerProjectId: string;
  state: "active" | "claimed" | "deleted";
  claimOperationId: string | null;
};
type Operation = {
  id: string;
  projectId: string;
  actorId: string;
  phase: "pending" | "completed";
};
type RpcReply = { data: unknown; error: Failure | null };

export const STORAGE_ORIGIN = "https://synthetic-platform.example.test";
export const CREATOR_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const OTHER_USER_ID = "aaaaaaaa-0000-4000-8000-000000000002";
export const ORGANIZATION_ID = "bbbbbbbb-0000-4000-8000-000000000001";

function emptyState() {
  return {
    sequence: 0,
    viewer: { id: CREATOR_ID } as { id: string } | null,
    projects: new Map<string, Row>(),
    members: [] as Row[],
    /** Accounts whose deletion fence is closed. */
    inactiveAccounts: new Set<string>(),
    stored: new Map<string, { id: string }>(),
    registry: new Map<string, Registered>(),
    operations: new Map<string, Operation>(),
    signedWaivers: new Map<string, number>(),
    /** Rows that exist but that the user's read returns nothing for. */
    hiddenFromReads: new Set<string>(),
    /** A failure the user's project read returns instead of a row. */
    projectReadFailure: null as Failure | null,
    waiverCountFailure: null as Failure | null,
    prepareOverride: null as RpcReply | null,
    finalizeOverride: null as RpcReply | null,
    assetLimit: 500,
    removalFailure: {} as Partial<Record<Bucket, Failure>>,
    removalLosesResponse: false,
    removalReportsSuccessWithoutRemoving: false,
    calendarFails: false,
    beforeRemoval: null as (() => void) | null,
    beforeFinalize: null as (() => void) | null,
    finalizeLosesResponse: false,
    rpcCalls: [] as Array<{ name: string; args: Row }>,
    removalCalls: [] as Array<{ bucket: string; paths: string[] }>,
    calendarCalls: [] as string[],
  };
}

/** Every piece of modeled state. Tests read and adjust it directly. */
export const db = emptyState();

export function resetModel() {
  Object.assign(db, emptyState());
}

export function nextUuid() {
  db.sequence += 1;
  return `00000000-0000-4000-8000-${String(db.sequence).padStart(12, "0")}`;
}

export const keyOf = (bucket: string, name: string) => `${bucket}/${name}`;
export const urlOf = (bucket: Bucket, name: string) =>
  `${STORAGE_ORIGIN}/storage/v1/object/public/${bucket}/${name}`;

/** The registered-object keys a project row links, as the SQL parser reads it. */
function referencesOf(project: Row): string[] {
  const urls = [
    project.cover_image_url,
    ...(Array.isArray(project.documents)
      ? project.documents.map((document: Row) => document?.url)
      : []),
  ];
  const keys = new Set<string>();
  for (const url of urls) {
    const linked = linkedObject(url);
    if (linked) keys.add(keyOf(linked.bucket, linked.name));
  }
  return [...keys];
}

function referencingProjects(key: string) {
  return [...db.projects.values()]
    .filter((project) => referencesOf(project).includes(key))
    .map((project) => String(project.id));
}

export function pendingOperation(projectId: string | null) {
  const operation = projectId ? db.operations.get(projectId) : undefined;
  return operation?.phase === "pending" ? operation : null;
}

function mayDelete(projectId: string, actorId: string) {
  const project = db.projects.get(projectId);
  if (!project) return false;
  return (
    project.creator_id === actorId ||
    db.members.some(
      (member) =>
        member.organization_id === project.organization_id &&
        member.user_id === actorId &&
        member.role === "admin" &&
        member.status === "active",
    )
  );
}

/** project_deletion_refusal: null when the actor may delete now. */
function refusal(projectId: string, actorId: string) {
  if (!mayDelete(projectId, actorId)) return "forbidden";
  return (db.signedWaivers.get(projectId) ?? 0) > 0 ? "signed_waivers" : null;
}

/** The reference fence on project writes, including identity reuse. */
function referenceFence(projectId: string, next: Row): Failure | null {
  const previous = db.projects.get(projectId);
  if (!previous && db.operations.has(projectId)) {
    return { code: "23514", message: "project_identity_retired" };
  }
  const before = previous ? referencesOf(previous) : [];
  const after = referencesOf(next);
  if (previous && before.join() === after.join()) return null;
  if (pendingOperation(projectId)) {
    return { code: "23514", message: "project_deletion_in_progress" };
  }
  const added = after.filter((key) => !before.includes(key));
  const unavailable = added.some(
    (key) => (db.registry.get(key)?.state ?? "active") !== "active",
  );
  return unavailable
    ? { code: "23514", message: "project_asset_unavailable" }
    : null;
}

/** An INSERT into projects, optionally under a caller-chosen identity. */
export function insertProject(payload: Row) {
  const id = typeof payload.id === "string" ? payload.id : nextUuid();
  if (db.projects.has(id)) {
    return { data: null, error: { code: "23505", message: "duplicate key" } };
  }
  const failure = referenceFence(id, payload);
  if (failure) return { data: null, error: failure };
  db.projects.set(id, { ...payload, id });
  return { data: { id }, error: null };
}

/** A direct browser write to a project's cover image or documents. */
export function writeProjectAssets(
  projectId: string,
  patch: Row,
): Failure | null {
  const project = db.projects.get(projectId);
  if (!project) throw new Error("Unknown project");
  const next = { ...project, ...patch };
  const failure = referenceFence(projectId, next);
  if (!failure) db.projects.set(projectId, next);
  return failure;
}

/** A Storage upload: fenced first, then registered only on proven ownership. */
export function upload(
  bucket: Bucket,
  name: string,
  uploaderId: string | null,
): Failure | null {
  const key = keyOf(bucket, name);
  const existing = db.registry.get(key);
  // A name a deletion claimed is never reused. One an ordinary removal freed is.
  if (
    existing &&
    (existing.state === "claimed" ||
      (existing.state === "deleted" && existing.claimOperationId))
  ) {
    return { code: "23514", message: "project_asset_object_retired" };
  }
  const projectId = nameProject(name);
  if (pendingOperation(projectId)) {
    return { code: "23514", message: "project_deletion_in_progress" };
  }
  const id = nextUuid();
  db.stored.set(key, { id });
  if (projectId && uploaderId && mayDelete(projectId, uploaderId)) {
    db.registry.set(key, {
      bucket,
      name,
      objectId: id,
      ownerProjectId: projectId,
      state: "active",
      claimOperationId: null,
    });
  }
  return null;
}

/** The delete guard every Storage removal passes through. */
export function removeStoredObject(
  bucket: string,
  name: string,
): Failure | null {
  const key = keyOf(bucket, name);
  const object = db.stored.get(key);
  if (!object) return null;
  const asset = db.registry.get(key);
  let claimProject: string | null = null;
  if (asset?.state === "claimed") {
    const operation = [...db.operations.values()].find(
      (candidate) =>
        candidate.id === asset.claimOperationId &&
        candidate.phase === "pending",
    );
    if (!operation) {
      return { code: "23514", message: "project_asset_claim_invalid" };
    }
    if (asset.objectId !== object.id) {
      return { code: "23514", message: "project_asset_object_replaced" };
    }
    // The actor carrying the deletion is authorized again at the removal.
    if (
      db.inactiveAccounts.has(operation.actorId) ||
      refusal(operation.projectId, operation.actorId)
    ) {
      return { code: "42501", message: "project_deletion_not_authorized" };
    }
    claimProject = operation.projectId;
  }
  const owner = nameProject(name);
  if (
    referencingProjects(key).some(
      (projectId) => projectId !== owner && projectId !== claimProject,
    )
  ) {
    return { code: "23503", message: "project_asset_referenced" };
  }
  db.stored.delete(key);
  // Claimed or not, a registered object that is removed is recorded as gone.
  if (asset && asset.state !== "deleted" && asset.objectId === object.id) {
    asset.state = "deleted";
  }
  return null;
}

function claimedObjects(operation: Operation) {
  return [...db.registry.values()]
    .filter((asset) => asset.claimOperationId === operation.id)
    .sort((left, right) =>
      keyOf(left.bucket, left.name).localeCompare(
        keyOf(right.bucket, right.name),
      ),
    )
    .map((asset) => ({
      bucket: asset.bucket,
      name: asset.name,
      objectId: asset.objectId,
      present: db.stored.has(keyOf(asset.bucket, asset.name)),
    }));
}

/** project_deletion_candidates. */
function candidatesFor(projectId: string, project: Row) {
  const own = referencesOf(project);
  return [...db.registry.values()].filter((asset) => {
    const key = keyOf(asset.bucket, asset.name);
    const ownerReleased =
      !db.projects.has(asset.ownerProjectId) &&
      db.operations.get(asset.ownerProjectId)?.phase === "completed";
    return (
      asset.state === "active" &&
      (asset.ownerProjectId === projectId ||
        (own.includes(key) && ownerReleased)) &&
      referencingProjects(key).every((id) => id === projectId)
    );
  });
}

/** The actor's own completed receipt for a project whose row is gone. */
function completedReceipt(projectId: string, actorId: string): unknown {
  const finished = db.operations.get(projectId);
  return !db.projects.has(projectId) &&
    finished?.phase === "completed" &&
    finished.actorId === actorId
    ? {
        outcome: "completed",
        operationId: finished.id,
        projectId,
        phase: "completed",
        replayed: true,
      }
    : { outcome: "project_not_found" };
}

function prepareDeletion(
  projectId: string,
  actorId: string,
  replayOnly: boolean,
): unknown {
  // Replay-only is a read: it never begins, resumes, or claims anything.
  if (replayOnly) return completedReceipt(projectId, actorId);
  if (db.inactiveAccounts.has(actorId)) return { outcome: "forbidden" };
  const project = db.projects.get(projectId);
  if (!project) return completedReceipt(projectId, actorId);
  const refused = refusal(projectId, actorId);
  if (refused) return { outcome: refused };

  let operation = db.operations.get(projectId);
  let outcome = "resumed";
  if (!operation) {
    const candidates = candidatesFor(projectId, project);
    if (candidates.length > db.assetLimit) {
      return { outcome: "asset_limit", assetCount: candidates.length };
    }
    operation = { id: nextUuid(), projectId, actorId, phase: "pending" };
    db.operations.set(projectId, operation);
    for (const asset of candidates) {
      asset.state = "claimed";
      asset.claimOperationId = operation.id;
    }
    outcome = "prepared";
  } else if (operation.phase !== "pending") {
    return { outcome: "invalid_state" };
  }
  operation.actorId = actorId;

  return {
    outcome,
    operationId: operation.id,
    projectId,
    phase: "pending",
    objects: claimedObjects(operation),
  };
}

function finalizeDeletion(
  operationId: string,
  projectId: string,
  actorId: string,
): unknown {
  if (db.inactiveAccounts.has(actorId)) return { outcome: "forbidden" };
  const operation = db.operations.get(projectId);
  if (!operation || operation.id !== operationId) {
    return { outcome: "operation_mismatch" };
  }
  const completed = {
    outcome: "completed",
    operationId,
    projectId,
    phase: "completed",
  };
  if (operation.phase === "completed") {
    return operation.actorId === actorId
      ? { ...completed, replayed: true }
      : { outcome: "forbidden" };
  }
  if (!db.projects.has(projectId)) return { outcome: "project_not_found" };
  const refused = refusal(projectId, actorId);
  if (refused) return { outcome: refused };

  const remaining = claimedObjects(operation).filter((asset) => asset.present);
  if (remaining.length > 0) {
    return {
      outcome: "objects_remaining",
      operationId,
      projectId,
      phase: "pending",
      objects: remaining,
    };
  }
  for (const asset of db.registry.values()) {
    if (asset.claimOperationId === operation.id) asset.state = "deleted";
  }
  db.projects.delete(projectId);
  operation.phase = "completed";
  operation.actorId = actorId;
  return { ...completed, replayed: false };
}

function queryBuilder(table: string) {
  const filters: Row = {};
  let inserted: Row | null = null;
  const builder: Record<string, unknown> = {};
  const resolve = () => {
    if (table === "projects") {
      if (inserted) return insertProject(inserted);
      if (db.projectReadFailure) {
        return { data: null, error: db.projectReadFailure };
      }
      const requested = String(filters.id);
      const project = db.hiddenFromReads.has(requested)
        ? null
        : (db.projects.get(requested) ?? null);
      return {
        data: project,
        error: project ? null : { code: "PGRST116", message: "no rows" },
      };
    }
    if (table === "organization_members") {
      const member = db.members.find((row) =>
        Object.entries(filters).every(
          ([column, value]) => row[column] === value,
        ),
      );
      return { data: member ?? null, error: null };
    }
    if (table === "waiver_signatures") {
      return db.waiverCountFailure
        ? { data: null, count: null, error: db.waiverCountFailure }
        : {
            data: null,
            count: db.signedWaivers.get(String(filters.project_id)) ?? 0,
            error: null,
          };
    }
    throw new Error(`Unexpected table ${table}`);
  };
  builder.select = () => builder;
  builder.insert = (payload: Row) => {
    inserted = payload;
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    filters[column] = value;
    return builder;
  };
  builder.single = async () => resolve();
  builder.maybeSingle = async () => {
    const result = resolve();
    // No row is not an error for maybeSingle; a real failure still is.
    return table === "projects" && !inserted && !db.projectReadFailure
      ? { data: result.data, error: null }
      : result;
  };
  builder.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return builder;
}

/** The one client shape the action sees, for both the user and service roles. */
export function modelClient() {
  return {
    from: queryBuilder,
    rpc: async (name: string, args: Row): Promise<RpcReply> => {
      db.rpcCalls.push({ name, args });
      if (name === "prepare_project_deletion") {
        return (
          db.prepareOverride ?? {
            data: prepareDeletion(
              String(args.p_project_id),
              String(args.p_actor_id),
              args.p_replay_only === true,
            ),
            error: null,
          }
        );
      }
      if (name === "finalize_project_deletion") {
        db.beforeFinalize?.();
        if (db.finalizeOverride) return db.finalizeOverride;
        const data = finalizeDeletion(
          String(args.p_operation_id),
          String(args.p_project_id),
          String(args.p_actor_id),
        );
        if (db.finalizeLosesResponse) {
          db.finalizeLosesResponse = false;
          throw new TypeError("synthetic lost response");
        }
        return { data, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from: (bucket: Bucket) => ({
        // A bucket listing is never deletion authority.
        list: async () => {
          throw new Error("Unexpected bucket listing");
        },
        remove: async (paths: string[]) => {
          db.removalCalls.push({ bucket, paths: [...paths] });
          db.beforeRemoval?.();
          if (db.removalFailure[bucket]) {
            return { data: null, error: db.removalFailure[bucket] };
          }
          if (db.removalReportsSuccessWithoutRemoving) {
            return { data: [], error: null };
          }
          for (const path of paths) {
            const refused = removeStoredObject(bucket, path);
            if (refused) return { data: null, error: refused };
          }
          if (db.removalLosesResponse) {
            db.removalLosesResponse = false;
            throw new TypeError("synthetic lost response");
          }
          return { data: [], error: null };
        },
      }),
    },
  };
}

export function seedProject(overrides: Row = {}) {
  const id = nextUuid();
  db.projects.set(id, {
    id,
    creator_id: CREATOR_ID,
    organization_id: null,
    title: "Synthetic project",
    description: "Synthetic",
    location: "Local",
    location_data: { text: "Local" },
    event_type: "oneTime",
    schedule: {
      oneTime: {
        date: "2026-09-15",
        startTime: "09:00",
        endTime: "11:00",
        volunteers: 5,
      },
      multiDay: [],
    },
    verification_method: "manual",
    require_login: true,
    visibility: "unlisted",
    can_be_managed_by_staff: false,
    project_timezone: "UTC",
    recurrence_rule: null,
    cover_image_url: null,
    documents: [],
    creator_calendar_event_id: null,
    status: "upcoming",
    workflow_status: "published",
    ...overrides,
  });
  return id;
}

/** Uploads a cover image and one document as the creator and links both. */
export function seedProjectWithFiles(overrides: Row = {}) {
  const id = seedProject(overrides);
  const cover = `project_${id}_cover_1.png`;
  const guide = `project_${id}_guide_1.pdf`;
  upload("project-images", cover, CREATOR_ID);
  upload("project-documents", guide, CREATOR_ID);
  writeProjectAssets(id, {
    cover_image_url: urlOf("project-images", cover),
    documents: [{ name: "guide.pdf", url: urlOf("project-documents", guide) }],
  });
  return {
    id,
    cover,
    guide,
    coverKey: keyOf("project-images", cover),
    guideKey: keyOf("project-documents", guide),
  };
}
