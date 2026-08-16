/**
 * Durable state for a project-creation attempt that stages a waiver project.
 *
 * A waiver project is created unpublished, before its PDF exists, and is only
 * published once the database can prove the waiver. Everything between those
 * two points has to survive a reload: an in-memory ref did not, which left an
 * invisible draft row behind and made every retry insert another one.
 *
 * The attempt therefore lives in browser storage:
 *
 * - `idempotencyKey` is minted once per attempt and sent with every create
 *   call, so the server converges on the same project row no matter how many
 *   times the attempt is retried or reloaded.
 * - `projectId` records the row that key resolved to.
 * - `uploadedFiles` / `waiverAttached` record the side effects that already
 *   succeeded, so a retry does not re-upload the cover image, the documents,
 *   or the waiver PDF (which would orphan the previous object).
 *
 * The attempt is cleared the moment the project is really published.
 */
export type StagedWaiverAttempt = {
  idempotencyKey: string;
  projectId: string | null;
  uploadedFiles: boolean;
  waiverAttached: boolean;
};

export type AttemptStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const STORAGE_KEY = "lets-assist:staged-project-attempt:v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function createStagedWaiverAttempt(
  idempotencyKey: string,
): StagedWaiverAttempt {
  return {
    idempotencyKey,
    projectId: null,
    uploadedFiles: false,
    waiverAttached: false,
  };
}

/**
 * Reads the stored attempt. Anything malformed is treated as absent rather
 * than trusted, so a corrupted entry starts a clean attempt instead of
 * pointing a retry at an arbitrary project id.
 */
export function readStagedWaiverAttempt(
  storage: AttemptStorage | null | undefined,
): StagedWaiverAttempt | null {
  if (!storage) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;

  const candidate = parsed as Partial<StagedWaiverAttempt>;
  if (!isUuid(candidate.idempotencyKey)) return null;

  return {
    idempotencyKey: candidate.idempotencyKey,
    projectId: isUuid(candidate.projectId) ? candidate.projectId : null,
    uploadedFiles: candidate.uploadedFiles === true,
    waiverAttached: candidate.waiverAttached === true,
  };
}

export function writeStagedWaiverAttempt(
  storage: AttemptStorage | null | undefined,
  attempt: StagedWaiverAttempt,
): void {
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // A storage failure only costs retry convergence, never correctness: the
    // project stays unpublished until the waiver is proven either way.
  }
}

export function clearStagedWaiverAttempt(
  storage: AttemptStorage | null | undefined,
): void {
  if (!storage) return;

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as writeStagedWaiverAttempt.
  }
}

/**
 * Returns the attempt to use for a submission: the stored one when it is still
 * mid-flight, otherwise a fresh attempt with a new key.
 */
export function resumeOrStartStagedWaiverAttempt(
  storage: AttemptStorage | null | undefined,
  newKey: string,
): StagedWaiverAttempt {
  return readStagedWaiverAttempt(storage) ?? createStagedWaiverAttempt(newKey);
}
