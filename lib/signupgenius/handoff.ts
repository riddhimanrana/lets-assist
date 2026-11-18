import { importPreviewSchema, type ImportPreview } from "./model";

export const IMPORT_STORAGE_PREFIX = "lets-assist:signupgenius:";
const LIFETIME = 24 * 60 * 60 * 1000;
export const IMPORT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function storeImportPreview(
  storage: Storage,
  id: string,
  preview: ImportPreview,
  now = Date.now(),
): string {
  if (!IMPORT_ID_PATTERN.test(id)) throw new Error("Invalid import reference");
  storage.setItem(
    IMPORT_STORAGE_PREFIX + id,
    JSON.stringify({
      version: 1,
      expires: now + LIFETIME,
      preview: importPreviewSchema.parse(preview),
    }),
  );
  return `/projects/create?import=${id}&creation=${id}`;
}

export function readImportPreview(
  storage: Storage,
  id: string,
  now = Date.now(),
): ImportPreview | null {
  if (!IMPORT_ID_PATTERN.test(id)) return null;
  const key = IMPORT_STORAGE_PREFIX + id;
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 100000) return null;
    const envelope = JSON.parse(raw);
    if (
      envelope.version !== 1 ||
      !Number.isFinite(envelope.expires) ||
      envelope.expires <= now ||
      envelope.expires > now + LIFETIME
    )
      throw new Error();
    return importPreviewSchema.parse(envelope.preview);
  } catch {
    storage.removeItem(key);
    return null;
  }
}
