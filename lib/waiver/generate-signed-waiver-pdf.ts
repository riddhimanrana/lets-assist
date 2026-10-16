import { safeConsole } from "@/lib/safe-console";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { SignaturePayload } from "@/types/waiver-definitions";
import { toRenderableText } from "./fonts/renderable-text";
import { createUnicodeTextRenderer } from "./fonts/unicode-text";
import {
  rectFitsVisibleEdges,
  requiredFieldsDue,
  usableRect,
  visiblePageEdges,
  type FieldRect,
} from "./pdf-geometry";

export { toRenderableText };

export interface PdfGenerationOptions {
  sourcePdfBytes: Uint8Array | ArrayBuffer;
  definition: {
    id: string;
    /** Which signers are optional. Only read to judge required fields. */
    signers?: Array<{ role_key: string; required?: boolean }>;
    fields?: Array<{
      field_key: string;
      field_type: string;
      page_index: number;
      rect: { x: number; y: number; width: number; height: number };
      signer_role_key: string | null;
      required?: boolean;
    }>;
  };
  signaturePayload: SignaturePayload;
  // Phase 2: Optional storage resolver for handling storage paths
  storageResolver?: (path: string) => Promise<ArrayBuffer>;
  /** IANA zone of the project. The "Signed:" stamp is rendered in it. */
  timeZone?: string | null;
  /**
   * Set by the server only when `definition` is its own fixed fallback for a
   * record with no stored definition. The fallback box was chosen for a Letter
   * page, so on a source page it does not fit it is moved, and shrunk if
   * needed, to stay on the visible page. A stored definition never sets this:
   * its placements are either usable as saved or refused.
   */
  fitFallbackSignatureToPage?: boolean;
}

export type SignedWaiverPdfErrorCode =
  | "encrypted_source"
  | "unreadable_source"
  | "unreadable_signature"
  | "unplaceable_signature";

// Fixed sentences. None of them quotes the document, a name, or a field value.
const SIGNED_WAIVER_PDF_ERROR_MESSAGES: Record<
  SignedWaiverPdfErrorCode,
  string
> = {
  encrypted_source: "The waiver PDF is password protected",
  unreadable_source: "The waiver PDF could not be read",
  unreadable_signature: "A waiver signature image could not be read",
  unplaceable_signature:
    "A waiver signature has no usable placement on the waiver PDF",
};

/** A signed copy the renderer cannot produce, with a reason a caller can show. */
export class SignedWaiverPdfError extends Error {
  readonly code: SignedWaiverPdfErrorCode;

  constructor(code: SignedWaiverPdfErrorCode) {
    super(SIGNED_WAIVER_PDF_ERROR_MESSAGES[code]);
    this.name = "SignedWaiverPdfError";
    this.code = code;
  }
}

/** Printed on a page where a character had no glyph in any bundled font. */
export const UNRENDERABLE_TEXT_NOTE =
  "Some characters could not be shown in this PDF. The signed record keeps the original text.";

/**
 * Whether a PDF is password protected. Used to refuse a source document at
 * upload time, because a protected source can never be stamped later.
 * A file that cannot be parsed at all reports false: that is a different fault.
 */
export async function isEncryptedPdf(
  bytes: Uint8Array | ArrayBuffer,
): Promise<boolean> {
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return document.isEncrypted;
  } catch {
    return false;
  }
}

async function loadSourceDocument(
  bytes: Uint8Array | ArrayBuffer,
): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes);
  } catch {
    // The parser's own message can quote document content, so it is dropped.
    throw new SignedWaiverPdfError(
      (await isEncryptedPdf(bytes)) ? "encrypted_source" : "unreadable_source",
    );
  }
}

/**
 * The "Signed:" stamp, in the project's zone with its abbreviation. An unknown
 * or missing zone falls back to UTC, which is labelled as such. Returns null
 * for a timestamp that is not a date.
 */
export function formatSignedAt(
  timestamp: unknown,
  timeZone?: string | null,
): string | null {
  const date = new Date(
    typeof timestamp === "string" || typeof timestamp === "number"
      ? timestamp
      : Number.NaN,
  );
  if (Number.isNaN(date.getTime())) return null;

  // Built from parts so the wording does not depend on the runtime's locale
  // data, which joins the date and time differently between versions.
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((one) => one.type === type)?.value ?? "";
    return `${part("month")} ${part("day")}, ${part("year")} at ${part("hour")}:${part("minute")} ${part("dayPeriod")} ${part("timeZoneName")}`
      .replace(/\s+/gu, " ")
      .trim();
  };

  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // Not a zone this runtime knows. Fall through to UTC.
    }
  }
  return format("UTC");
}

// Page measurement is shared with the save, signing, and confirmation checks
// (see `pdf-geometry.ts`), so a box they accept is a box this renderer draws.
const visibleEdges = visiblePageEdges;

function fitsOnPage(rect: FieldRect, page: PDFPage): boolean {
  return rectFitsVisibleEdges(rect, visibleEdges(page));
}

/** The "Signed:" stamp: its font size and how far its baseline sits under a box. */
const SIGNED_STAMP_SIZE = 8;
const SIGNED_STAMP_DROP = 12;
/** Room kept under a fallback box for the stamp, descenders included. */
const SIGNED_STAMP_RESERVE = SIGNED_STAMP_DROP + 4;

/** The page height the server's fallback box was positioned for. */
const LETTER_HEIGHT = 792;
/** A fallback box smaller than this cannot hold a legible signature. */
const MIN_FALLBACK_WIDTH = 120;
const MIN_FALLBACK_HEIGHT = 24;

/**
 * Where the server's fallback signature box goes on a real page. The box is
 * returned untouched when it and its stamp already sit on the visible page, so
 * a Letter source is stamped exactly where it always was. Otherwise the box
 * keeps its Letter distance from the top-left corner of the visible page as
 * far as the page allows, and shrinks only when the page is smaller than the
 * box. Returns null when the page cannot hold a legible box and the stamp.
 */
function fallbackPlacement(
  rect: FieldRect,
  page: PDFPage,
  stampWidth: number,
): FieldRect | null {
  if (rect.width <= 0 || rect.height <= 0) return null;

  const visible = visibleEdges(page);
  const fitsWithStamp =
    rect.x >= visible.left &&
    rect.x + Math.max(rect.width, stampWidth) <= visible.right &&
    rect.y - SIGNED_STAMP_RESERVE >= visible.bottom &&
    rect.y + rect.height <= visible.top;
  if (fitsWithStamp) return rect;

  const availableWidth = visible.right - visible.left;
  const availableHeight = visible.top - visible.bottom - SIGNED_STAMP_RESERVE;
  const width = Math.min(rect.width, availableWidth);
  const height = Math.min(rect.height, availableHeight);
  // The stamp starts at the box's left edge and can be wider than the box.
  const span = Math.max(width, stampWidth);
  if (
    width < MIN_FALLBACK_WIDTH ||
    height < MIN_FALLBACK_HEIGHT ||
    span > availableWidth
  ) {
    return null;
  }

  const leftInset = Math.min(Math.max(rect.x, 0), availableWidth - span);
  const topInset = Math.min(
    Math.max(LETTER_HEIGHT - (rect.y + rect.height), 0),
    availableHeight - height,
  );

  return {
    x: visible.left + leftInset,
    y: visible.top - topInset - height,
    width,
    height,
  };
}

const TEXT_FIELD_TYPES = new Set([
  "text",
  "name",
  "email",
  "phone",
  "date",
  "address",
  "initial",
  "radio",
  "dropdown",
]);

/**
 * Generates a signed waiver PDF on-demand by stamping signatures onto the original PDF.
 * Returns a Buffer containing the flattened PDF.
 *
 * Phase 2: Now supports both data URLs and storage paths for signatures.
 * If signature data is a storage path, storageResolver must be provided.
 *
 * Phase 4 Coordinate System:
 * - Input field coordinates are in PDF coordinate space (bottom-left origin, PDF points)
 * - pdf-lib drawing APIs use the same bottom-left origin
 * - Therefore coordinates are used directly without y-axis flipping
 *
 * Text the standard Helvetica font can encode is drawn with it, so an ordinary
 * waiver loads no font file. Anything else is drawn with a bundled Noto font
 * (see `lib/waiver/fonts`), embedded as a subset. A character no bundled font
 * holds is reduced by `toRenderableText` and the page carries a note.
 * Generation never throws on a character: if the Unicode path fails, the same
 * waiver is rendered again with the standard font and the note.
 */
export async function generateSignedWaiverPdf(
  options: PdfGenerationOptions,
): Promise<Buffer> {
  try {
    return await renderSignedWaiverPdf(options, true);
  } catch (error) {
    if (!(error instanceof UnicodeFontFailure)) throw error;
    return renderSignedWaiverPdf(options, false);
  }
}

/** The embedded Unicode fonts could not be written into the document. */
class UnicodeFontFailure extends Error {}

function reportDiagnostic() {
  // Names and field values are never logged, only that something failed.
  safeConsole.error(
    "Application diagnostic from lib/waiver/generate-signed-waiver-pdf",
  );
}

type SignaturePlacementOptions = Pick<
  PdfGenerationOptions,
  | "sourcePdfBytes"
  | "definition"
  | "signaturePayload"
  | "timeZone"
  | "fitFallbackSignatureToPage"
>;

/**
 * Loads the source and decides where every signed signature goes, before
 * anything is drawn or read from storage. Throws when a signed signer has no
 * usable placement. Rendering and the pre-signing check both start here, so
 * they cannot disagree.
 */
async function planSignaturePlacements(options: SignaturePlacementOptions) {
  const {
    sourcePdfBytes,
    definition,
    signaturePayload,
    timeZone,
    fitFallbackSignatureToPage = false,
  } = options;

  // The source is loaded through the bounded, Storage-aware server loader.
  // Keeping network access out of this renderer prevents callers from turning
  // persisted waiver metadata into an SSRF primitive.
  const pdfDoc = await loadSourceDocument(sourcePdfBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const encodable = new Set(font.getCharacterSet());

  // An optional field that names a page the document does not have is skipped.
  // A signed signer's placement is held to a stricter rule further down.
  const pageFor = (pageIndex: number | null | undefined): PDFPage | null => {
    const index = pageIndex ?? 0;
    if (!Number.isInteger(index) || index < 0) return null;
    return pages[index] ?? null;
  };

  // An upper estimate of how wide text draws on one line. Text that needs a
  // Unicode font is measured through its standard-font stand-in, so each of
  // its characters is also allowed a full em.
  const drawnWidth = (value: unknown, size: number): number => {
    const { text, substituted } = toRenderableText(value, encodable);
    return Math.max(
      0,
      ...text.split("\n").map((line) => {
        const fullEms = substituted ? Array.from(line).length * size : 0;
        try {
          return Math.max(font.widthOfTextAtSize(line, size), fullEms);
        } catch {
          return Math.max(Array.from(line).length * size, fullEms);
        }
      }),
    );
  };

  // 2. Get signature placements from definition
  const signatureFields =
    definition.fields?.filter((f) => f.field_type === "signature") || [];

  // Only the server's fallback box is ever moved, and only into this map. The
  // definition and its fields are never written to.
  const relocatedFallbackRects = new Map<
    (typeof signatureFields)[number],
    FieldRect
  >();
  const widestStamp = fitFallbackSignatureToPage
    ? Math.max(
        0,
        ...(signaturePayload.signers ?? []).map((signer) => {
          const signedAt = formatSignedAt(signer.timestamp, timeZone);
          return signedAt
            ? drawnWidth(`Signed: ${signedAt}`, SIGNED_STAMP_SIZE)
            : 0;
        }),
      )
    : 0;

  // A signer who actually signed must land on the document. A role with no
  // signature placement, or a placement on a missing page or outside the page,
  // would otherwise produce a PDF that looks signed and is not. This runs
  // before anything is drawn or read from storage. A signer with no signature
  // data is optional and keeps the lenient skipping below.
  const signedRoleKeys = new Set<string>();
  for (const signerSignature of signaturePayload.signers ?? []) {
    const isSigned =
      (signerSignature.method === "typed" ||
        signerSignature.method === "draw" ||
        signerSignature.method === "upload") &&
      typeof signerSignature.data === "string" &&
      signerSignature.data.trim().length > 0;
    if (!isSigned) continue;
    signedRoleKeys.add(signerSignature.role_key);

    const signerFields = signatureFields.filter(
      (f) => f.signer_role_key === signerSignature.role_key,
    );
    const everyFieldFits = signerFields.every((field) => {
      const page = pageFor(field.page_index);
      const rect = usableRect(field.rect);
      if (page === null || rect === null) return false;
      if (!fitFallbackSignatureToPage) return fitsOnPage(rect, page);

      const placed = fallbackPlacement(rect, page, widestStamp);
      if (placed && placed !== rect) relocatedFallbackRects.set(field, placed);
      return placed !== null;
    });
    if (signerFields.length === 0 || !everyFieldFits) {
      throw new SignedWaiverPdfError("unplaceable_signature");
    }
  }

  // A required field of a stored definition must land on the document too.
  // Skipping it would produce a copy that looks complete and is missing what
  // the organizer required. A field of an optional signer who did not sign,
  // and every optional field, keeps the lenient skipping when it is drawn.
  const requiredFields = requiredFieldsDue(
    definition.fields ?? [],
    definition.signers ?? [],
    signedRoleKeys,
  );
  for (const field of requiredFields) {
    const page = pageFor(field.page_index);
    const rect = usableRect(field.rect);
    if (page === null || rect === null || !fitsOnPage(rect, page)) {
      throw new SignedWaiverPdfError("unplaceable_signature");
    }
  }

  return {
    pdfDoc,
    font,
    encodable,
    pageFor,
    drawnWidth,
    signatureFields,
    relocatedFallbackRects,
  };
}

/**
 * Whether a signed copy could be stamped onto these exact source bytes, by the
 * renderer's own rule and without drawing, saving, or reading a signature
 * asset. Rejects with the same `SignedWaiverPdfError` rendering would.
 */
export async function assertSignedWaiverPlaceable(
  options: SignaturePlacementOptions,
): Promise<void> {
  await planSignaturePlacements(options);
}

async function renderSignedWaiverPdf(
  options: PdfGenerationOptions,
  allowUnicodeFonts: boolean,
): Promise<Buffer> {
  const { definition, signaturePayload, storageResolver, timeZone } = options;
  const {
    pdfDoc,
    font,
    encodable,
    pageFor,
    drawnWidth,
    signatureFields,
    relocatedFallbackRects,
  } = await planSignaturePlacements(options);
  const pagesWithSubstitutions = new Set<PDFPage>();
  const unicode = createUnicodeTextRenderer(pdfDoc, font, encodable);

  const drawText = async (
    page: PDFPage,
    value: unknown,
    drawOptions: {
      x: number;
      y: number;
      size: number;
      maxWidth?: number;
      gray?: boolean;
    },
  ) => {
    const { text, substituted } = toRenderableText(value, encodable);
    if (substituted && allowUnicodeFonts) {
      try {
        const drawn = await unicode.draw(page, value, drawOptions);
        if (drawn.substituted) pagesWithSubstitutions.add(page);
        return;
      } catch {
        // Nothing was painted. Fall through to the standard font and the note.
        reportDiagnostic();
      }
    }
    if (substituted) pagesWithSubstitutions.add(page);
    if (text.trim().length === 0) return;

    page.drawText(text, {
      x: drawOptions.x,
      y: drawOptions.y,
      size: drawOptions.size,
      font,
      color: drawOptions.gray ? rgb(0.5, 0.5, 0.5) : rgb(0, 0, 0),
      ...(drawOptions.maxWidth
        ? { maxWidth: drawOptions.maxWidth, lineHeight: drawOptions.size }
        : {}),
    });
  };

  const drawSignedStamp = async (
    page: PDFPage,
    rect: FieldRect,
    at: unknown,
  ) => {
    const signedAt = formatSignedAt(at, timeZone);
    if (!signedAt) return;
    await drawText(page, `Signed: ${signedAt}`, {
      x: rect.x,
      y: rect.y - SIGNED_STAMP_DROP,
      size: SIGNED_STAMP_SIZE,
      gray: true,
    });
  };

  // 3. For each signature in payload, find corresponding placement and stamp
  for (const signerSignature of signaturePayload.signers ?? []) {
    // Phase 1 Fix: Upload method now refers to image signature uploads, not full waiver uploads
    // These should be stamped like draw method signatures
    // Full waiver uploads are handled via upload_storage_path (offline mode), not in payload

    // Find fields for this signer role
    const signerFields = signatureFields.filter(
      (f) => f.signer_role_key === signerSignature.role_key,
    );
    const signatureData =
      typeof signerSignature.data === "string" ? signerSignature.data : "";

    for (const field of signerFields) {
      const page = pageFor(field.page_index);
      const relocated = relocatedFallbackRects.get(field);
      const rect = relocated ?? usableRect(field.rect);
      if (!page || !rect) continue;

      // Handle typed signatures (draw text instead of image)
      if (signerSignature.method === "typed") {
        let fontSize = Math.max(6, Math.min(rect.height * 0.6, 24)); // Scale font to fit
        if (relocated) {
          // A moved fallback box sits on a page narrower or shorter than
          // Letter, so a long name is scaled down to end before the page does.
          const room = visibleEdges(page).right - (rect.x + 5);
          const width = drawnWidth(signatureData, fontSize);
          if (width > room) {
            fontSize = Math.max(6, (fontSize * room) / width);
          }
        }
        await drawText(page, signatureData, {
          x: rect.x + 5,
          y: rect.y + rect.height / 2 - fontSize / 3,
          size: fontSize,
        });
        await drawSignedStamp(page, rect, signerSignature.timestamp);
        continue;
      }

      // Only a drawn or uploaded signature is an image. Any other method
      // must never reach the storage read below.
      if (
        signerSignature.method !== "draw" &&
        signerSignature.method !== "upload"
      ) {
        continue;
      }

      // Handle drawn signatures (embed as image)

      // Phase 2: Detect if data is a data URL or storage path
      const isDataUrl = signatureData.startsWith("data:");
      let imageBytes: Buffer | ArrayBuffer;

      if (isDataUrl) {
        // Existing logic: extract from data URL
        const base64Data = signatureData.split(",")[1] ?? "";
        imageBytes = Buffer.from(base64Data, "base64");
      } else {
        // New logic: treat as storage path, use resolver
        if (!storageResolver) {
          throw new Error(
            "Storage resolver required for storage-path signatures",
          );
        }
        const resolvedBytes = await storageResolver(signatureData);
        imageBytes = Buffer.from(resolvedBytes);
      }

      let signatureImage;
      try {
        // Determine image type from data or try both formats
        if (isDataUrl) {
          if (signatureData.startsWith("data:image/png")) {
            signatureImage = await pdfDoc.embedPng(imageBytes);
          } else if (
            signatureData.startsWith("data:image/jpeg") ||
            signatureData.startsWith("data:image/jpg")
          ) {
            signatureImage = await pdfDoc.embedJpg(imageBytes);
          }
        } else {
          // For storage paths, try PNG first (most common for signatures)
          try {
            signatureImage = await pdfDoc.embedPng(imageBytes);
          } catch {
            // If PNG fails, try JPG
            signatureImage = await pdfDoc.embedJpg(imageBytes);
          }
        }
      } catch {
        reportDiagnostic();
        throw new SignedWaiverPdfError("unreadable_signature");
      }

      if (!signatureImage)
        throw new SignedWaiverPdfError("unreadable_signature");

      // Signature boxes detected from text baselines can be too small.
      // Enforce a sane minimum for image signatures while clamping to page bounds.
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      const minSigWidth = 180;
      const minSigHeight = 50;

      const desiredWidth = Math.max(rect.width, minSigWidth);
      const desiredHeight = Math.max(rect.height, minSigHeight);

      // A moved fallback box was already sized to the visible page, so the
      // image fills it exactly instead of growing back to the minimum.
      const finalWidth = relocated
        ? rect.width
        : Math.min(desiredWidth, Math.max(1, pageWidth - rect.x));
      const finalHeight = relocated
        ? rect.height
        : Math.min(desiredHeight, Math.max(1, pageHeight - rect.y));

      // Draw the signature
      page.drawImage(signatureImage, {
        x: rect.x,
        y: rect.y,
        width: finalWidth,
        height: finalHeight,
      });

      await drawSignedStamp(page, rect, signerSignature.timestamp);
    }
  }

  // Phase 3: Stamp non-signature fields (text-like fields, date, checkbox, legacy radio/dropdown)
  const nonSignatureFields =
    definition.fields?.filter((f) => f.field_type !== "signature") || [];

  for (const field of nonSignatureFields) {
    const value = signaturePayload.fields?.[field.field_key];

    // Skip if no value provided (optional fields)
    if (value === undefined || value === null) continue;

    const page = pageFor(field.page_index);
    if (!page) continue;

    const rect = usableRect(field.rect) ?? {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
    };
    const verticalPadding = Math.max(0, Math.min(2, rect.height * 0.08));
    const textPaddingX = Math.max(1, Math.min(4, rect.width * 0.06));
    const textFontSize = Math.max(8, Math.min(12, rect.height * 0.72));
    const textX = rect.x + textPaddingX;
    const textMaxWidth = Math.max(1, rect.width - textPaddingX * 2);

    if (TEXT_FIELD_TYPES.has(field.field_type)) {
      // An address usually wraps, so a box tall enough for more than one line
      // is filled from its top edge. Every other value sits on one centered line.
      const fillsFromTop =
        field.field_type === "address" && rect.height >= textFontSize * 2;
      const textY = fillsFromTop
        ? rect.y + rect.height - textFontSize - verticalPadding
        : rect.y +
          Math.max(0, (rect.height - textFontSize) / 2) +
          verticalPadding;

      await drawText(page, Array.isArray(value) ? value.join(", ") : value, {
        x: textX,
        y: textY,
        size: textFontSize,
        maxWidth: textMaxWidth,
      });
      continue;
    }

    if (field.field_type === "checkbox") {
      // Draw check marker if checked.
      // NOTE: Avoid unicode glyphs like '✓' because default PDF WinAnsi fonts cannot encode them.
      if (value === true || value === "true" || value === "yes") {
        const checkboxFontSize = Math.max(
          8,
          Math.min(16, Math.min(rect.width, rect.height) * 0.85),
        );
        await drawText(page, "X", {
          x: rect.x + Math.max(0, (rect.width - checkboxFontSize * 0.55) / 2),
          y:
            rect.y +
            Math.max(0, (rect.height - checkboxFontSize) / 2) +
            verticalPadding,
          size: checkboxFontSize,
        });
      }
    }
  }

  if (unicode.state.fontUnavailable) reportDiagnostic();

  // Say so on every page where the printed text differs from what was entered.
  for (const page of pagesWithSubstitutions) {
    page.drawText(UNRENDERABLE_TEXT_NOTE, {
      x: 24,
      y: 14,
      size: 7,
      font,
      color: rgb(0.5, 0.5, 0.5),
      maxWidth: Math.max(1, page.getWidth() - 48),
      lineHeight: 8,
    });
  }

  // 4. Flatten form fields (if any exist)
  try {
    pdfDoc.getForm().flatten();
  } catch {
    // No form fields to flatten, or already flat
  }

  // 5. Save and return the PDF bytes
  try {
    return Buffer.from(await pdfDoc.save());
  } catch (error) {
    if (unicode.state.embeddedFonts === 0) throw error;
    reportDiagnostic();
    throw new UnicodeFontFailure();
  }
}

/**
 * Helper: Check if signature payload requires PDF generation.
 * Phase 1 Fix: Upload method in multi-signer payload means "uploaded signature image", not full waiver.
 * These still require PDF generation (stamping the uploaded signature image onto the waiver).
 * Returns true for any multi-signer payload (draw/typed/upload all need stamping).
 * Only returns false for single offline full-waiver upload (handled via upload_storage_path column).
 */
export function requiresPdfGeneration(_payload: SignaturePayload): boolean {
  // Multi-signer payloads always need PDF generation
  // All signature methods (draw/typed/upload) are images that need stamping
  return true;
}
