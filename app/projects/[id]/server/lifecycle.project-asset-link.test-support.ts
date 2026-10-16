/**
 * The link parser of the fictional lifecycle model, kept beside it as test
 * support only. It mirrors app_private.project_asset_reference in migration
 * 20261011112500 and holds no test cases.
 */

const CANONICAL_NAME =
  /^project_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_[A-Za-z0-9._-]+$/u;
const PUBLIC_OBJECT_PATH =
  /^https?:\/\/[^/?#]+\/storage\/v1\/object\/public\/([^/?#]+)\/([^/?#]+)(?:[?#].*)?$/u;
const CANONICAL_CHARACTER = /^[A-Za-z0-9._-]$/u;
const PROJECT_BUCKETS = ["project-images", "project-documents"];

/** The project a canonical object name was uploaded for, or null. */
export function nameProject(name: string) {
  return name.length <= 255 ? (CANONICAL_NAME.exec(name)?.[1] ?? null) : null;
}

/**
 * One path segment with one layer of percent-encoding removed, or null when
 * any character, literal or encoded, is not one a canonical name can contain.
 * An encoded percent sign is refused, so nothing is decoded twice.
 */
function decodeSegment(segment: string): string | null {
  let plain = "";
  for (let index = 0; index < segment.length;) {
    let piece = segment[index];
    if (piece === "%") {
      const escape = segment.slice(index, index + 3);
      if (!/^%[0-9a-fA-F]{2}$/u.test(escape)) return null;
      const code = Number.parseInt(escape.slice(1), 16);
      if (code < 45 || code > 122) return null;
      piece = String.fromCharCode(code);
      index += 3;
    } else {
      index += 1;
    }
    if (!CANONICAL_CHARACTER.test(piece)) return null;
    plain += piece;
  }
  return plain;
}

/** The (bucket, object name) a stored URL links, or null. */
export function linkedObject(
  url: unknown,
): { bucket: string; name: string } | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  const parts = PUBLIC_OBJECT_PATH.exec(url);
  if (!parts) return null;
  const bucket = decodeSegment(parts[1]);
  const name = decodeSegment(parts[2]);
  if (bucket === null || name === null) return null;
  if (!PROJECT_BUCKETS.includes(bucket) || !nameProject(name)) return null;
  return { bucket, name };
}
