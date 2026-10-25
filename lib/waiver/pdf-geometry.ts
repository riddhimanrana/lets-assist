import { PDFDocument, type PDFPage } from "pdf-lib";

/**
 * The one definition of "this placement is on the waiver PDF". The renderer,
 * the definition save, signature preparation, and guest confirmation all read
 * a page through these functions, so they cannot disagree about a box.
 */

export type FieldRect = { x: number; y: number; width: number; height: number };

/** The part of a page a viewer shows, as edges in raw PDF points. */
export type VisiblePageEdges = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

/** The visible area of every page of a source PDF, in page order. */
export type WaiverSourceGeometry = { pages: VisiblePageEdges[] };

export type WaiverSourceGeometryErrorCode =
  "encrypted_source" | "unreadable_source";

/** A source PDF that cannot be measured. The message never quotes the file. */
export class WaiverSourceGeometryError extends Error {
  readonly code: WaiverSourceGeometryErrorCode;

  constructor(code: WaiverSourceGeometryErrorCode) {
    super(
      code === "encrypted_source"
        ? "The waiver PDF is password protected"
        : "The waiver PDF could not be read",
    );
    this.name = "WaiverSourceGeometryError";
    this.code = code;
  }
}

/** Slack, in PDF points, for rounding in placements clamped to the page edge. */
export const PLACEMENT_TOLERANCE = 1;

/**
 * The box the server stamps when a record has no stored definition. It must
 * stay equal to `singleSignerDefinition` in `serve-signed-waiver.ts`.
 */
export const SYNTHETIC_SINGLE_SIGNER_RECT: Readonly<FieldRect> = Object.freeze({
  x: 100,
  y: 650,
  width: 250,
  height: 60,
});

export function usableRect(
  rect: FieldRect | null | undefined,
): FieldRect | null {
  if (!rect || typeof rect !== "object") return null;
  const values = [rect.x, rect.y, rect.width, rect.height];
  return values.every(
    (value) => typeof value === "number" && Number.isFinite(value),
  )
    ? rect
    : null;
}

/** The part of a page a viewer shows: where its media and crop boxes overlap. */
export function visiblePageEdges(page: PDFPage): VisiblePageEdges {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const edges = (box: FieldRect) => ({
    left: Math.min(box.x, box.x + box.width),
    right: Math.max(box.x, box.x + box.width),
    bottom: Math.min(box.y, box.y + box.height),
    top: Math.max(box.y, box.y + box.height),
  });
  const [mediaEdges, cropEdges] = [edges(media), edges(crop)];

  return {
    left: Math.max(mediaEdges.left, cropEdges.left),
    right: Math.min(mediaEdges.right, cropEdges.right),
    bottom: Math.max(mediaEdges.bottom, cropEdges.bottom),
    top: Math.min(mediaEdges.top, cropEdges.top),
  };
}

/**
 * Whether a box lies on the part of the page a viewer shows. The waiver
 * builder places boxes in the same space: raw PDF points inside the crop box,
 * which is not always anchored at the origin. A box smaller than a signature
 * is accepted, because the drawing code enlarges it. A box with no area is
 * not: it pins nothing to the page, and saving never allowed one.
 */
export function rectFitsVisibleEdges(
  rect: FieldRect,
  visible: VisiblePageEdges,
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;

  return (
    rect.x >= visible.left - PLACEMENT_TOLERANCE &&
    rect.y >= visible.bottom - PLACEMENT_TOLERANCE &&
    rect.x + rect.width <= visible.right + PLACEMENT_TOLERANCE &&
    rect.y + rect.height <= visible.top + PLACEMENT_TOLERANCE
  );
}

/**
 * Measures the actual bytes of a source PDF. A protected file, a file the
 * parser rejects, and a file with no pages are all refused: none of them can
 * hold a placement.
 */
export async function readWaiverSourceGeometry(
  bytes: Uint8Array | ArrayBuffer,
): Promise<WaiverSourceGeometry> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    // The parser's own message can quote document content, so it is dropped.
    throw new WaiverSourceGeometryError("unreadable_source");
  }
  if (document.isEncrypted) {
    throw new WaiverSourceGeometryError("encrypted_source");
  }

  let pages: VisiblePageEdges[];
  try {
    pages = document.getPages().map(visiblePageEdges);
  } catch {
    throw new WaiverSourceGeometryError("unreadable_source");
  }
  // A page with a non-finite or empty visible area cannot hold a placement, so
  // the document is not treated as measurable.
  const measurable = pages.every(
    (page) =>
      [page.left, page.right, page.bottom, page.top].every(Number.isFinite) &&
      page.right > page.left &&
      page.top > page.bottom,
  );
  if (pages.length === 0 || !measurable) {
    throw new WaiverSourceGeometryError("unreadable_source");
  }

  return { pages };
}

export type WaiverPlacementField = {
  field_type: string;
  page_index: number | null | undefined;
  rect: FieldRect | null | undefined;
  signer_role_key?: string | null;
  required?: boolean;
};

export type WaiverPlacementSigner = { role_key: string; required?: boolean };

/** Whether one stored field names a real page and lies on its visible area. */
export function fieldFitsSource(
  field: Pick<WaiverPlacementField, "page_index" | "rect">,
  geometry: WaiverSourceGeometry,
): boolean {
  const index = field.page_index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return false;
  }
  const page = geometry.pages[index];
  const rect = usableRect(field.rect);
  if (page === undefined || rect === null) return false;
  return rectFitsVisibleEdges(rect, page);
}

/**
 * The non-signature fields that must land on the document: every required
 * one, except those of an optional signer who did not sign. That signer
 * skipped their whole section, so its fields keep the lenient skipping. A
 * field with no signer, or whose signer the definition does not list, is due.
 */
export function requiredFieldsDue<Field extends WaiverPlacementField>(
  fields: ReadonlyArray<Field>,
  signers: ReadonlyArray<WaiverPlacementSigner>,
  signedRoleKeys: ReadonlySet<string>,
): Field[] {
  const signerByRole = new Map(
    signers.map((signer) => [signer.role_key, signer]),
  );

  return fields.filter((field) => {
    if (field.field_type === "signature" || field.required !== true) {
      return false;
    }
    const owner = field.signer_role_key
      ? signerByRole.get(field.signer_role_key)
      : undefined;
    return !(
      owner !== undefined &&
      owner.required === false &&
      !signedRoleKeys.has(owner.role_key)
    );
  });
}

/**
 * Whether signed evidence has a usable place on the source PDF. Nothing is
 * moved to make it fit.
 *
 * - Every signer who signed, and every required signer, needs at least one
 *   signature field, and each of that signer's signature fields must fit.
 * - Every required non-signature field must fit, unless it belongs to an
 *   optional signer who did not sign.
 *
 * Optional fields nobody was required to fill keep the renderer's lenient
 * handling and are not judged here.
 */
export function evidencePlacementFits(input: {
  geometry: WaiverSourceGeometry;
  signers: ReadonlyArray<WaiverPlacementSigner>;
  fields: ReadonlyArray<WaiverPlacementField>;
  signedRoleKeys: ReadonlyArray<string>;
}): boolean {
  const { geometry, signers, fields } = input;
  const signed = new Set(input.signedRoleKeys);
  const mustSign = new Set(signed);
  for (const signer of signers) {
    if (signer.required) mustSign.add(signer.role_key);
  }

  for (const roleKey of mustSign) {
    const signatureFields = fields.filter(
      (field) =>
        field.field_type === "signature" && field.signer_role_key === roleKey,
    );
    if (
      signatureFields.length === 0 ||
      !signatureFields.every((field) => fieldFitsSource(field, geometry))
    ) {
      return false;
    }
  }

  return requiredFieldsDue(fields, signers, signed).every((field) =>
    fieldFitsSource(field, geometry),
  );
}
