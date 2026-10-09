import { safeConsole } from "@/lib/safe-console";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { SignaturePayload } from "@/types/waiver-definitions";

export interface PdfGenerationOptions {
  sourcePdfBytes: Uint8Array | ArrayBuffer;
  definition: {
    id: string;
    fields?: Array<{
      field_key: string;
      field_type: string;
      page_index: number;
      rect: { x: number; y: number; width: number; height: number };
      signer_role_key: string | null;
    }>;
  };
  signaturePayload: SignaturePayload;
  // Phase 2: Optional storage resolver for handling storage paths
  storageResolver?: (path: string) => Promise<ArrayBuffer>;
  /** IANA zone of the project. The "Signed:" stamp is rendered in it. */
  timeZone?: string | null;
}

export type SignedWaiverPdfErrorCode = "encrypted_source" | "unreadable_source";

/** A source document the renderer cannot stamp, with a reason a caller can show. */
export class SignedWaiverPdfError extends Error {
  readonly code: SignedWaiverPdfErrorCode;

  constructor(code: SignedWaiverPdfErrorCode) {
    super(
      code === "encrypted_source"
        ? "The waiver PDF is password protected"
        : "The waiver PDF could not be read",
    );
    this.name = "SignedWaiverPdfError";
    this.code = code;
  }
}

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

// Letters the standard PDF font cannot encode and Unicode cannot decompose.
const LATIN_FALLBACKS: Record<string, string> = {
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ħ: "h",
  Ħ: "H",
  ı: "i",
  ŧ: "t",
  Ŧ: "T",
};

/**
 * Rewrites text so the embedded standard font can always encode it.
 *
 * The standard PDF fonts only cover WinAnsi, and pdf-lib throws on anything
 * else. A character it cannot encode is reduced to its base letter where one
 * exists (Polish, Vietnamese) and replaced with "?" otherwise (Chinese, Hindi).
 * `substituted` reports that the output no longer matches the input, so the
 * caller can say so on the page.
 */
export function toRenderableText(
  input: unknown,
  encodable: ReadonlySet<number>,
): { text: string; substituted: boolean } {
  const source = (typeof input === "string" ? input : String(input ?? ""))
    .normalize("NFC")
    .replace(/\r\n?/g, "\n");
  let text = "";
  let substituted = false;

  for (const character of source) {
    if (character === "\n") {
      text += character;
      continue;
    }

    const codePoint = character.codePointAt(0) ?? 0;
    if (encodable.has(codePoint)) {
      text += character;
      continue;
    }

    // Tabs, no-break spaces, and other spacing or control characters.
    if (/[\p{Zs}\p{Cc}]/u.test(character)) {
      text += " ";
      continue;
    }

    // Joiners and variation selectors carry no glyph of their own.
    if (/\p{Cf}/u.test(character)) continue;

    substituted = true;
    if (/\p{M}/u.test(character)) continue;

    const base =
      LATIN_FALLBACKS[character] ??
      character.normalize("NFD").replace(/\p{M}/gu, "");
    const baseIsEncodable =
      base.length > 0 &&
      base !== character &&
      Array.from(base).every((part) => encodable.has(part.codePointAt(0) ?? 0));
    text += baseIsEncodable ? base : "?";
  }

  return { text, substituted };
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

  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
      timeZoneName: "short",
    })
      .format(date)
      .replace(/\s+/gu, " ");

  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // Not a zone this runtime knows. Fall through to UTC.
    }
  }
  return format("UTC");
}

type FieldRect = { x: number; y: number; width: number; height: number };

function usableRect(rect: FieldRect | null | undefined): FieldRect | null {
  if (!rect) return null;
  const values = [rect.x, rect.y, rect.width, rect.height];
  return values.every((value) => Number.isFinite(value)) ? rect : null;
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
 * Text is drawn with the standard Helvetica font. A Unicode font needs
 * `@pdf-lib/fontkit` and a bundled font file, neither of which this repository
 * has, so text outside WinAnsi goes through `toRenderableText` and the page
 * carries a note. Generation never throws on a character.
 */
export async function generateSignedWaiverPdf(
  options: PdfGenerationOptions,
): Promise<Buffer> {
  const {
    sourcePdfBytes,
    definition,
    signaturePayload,
    storageResolver,
    timeZone,
  } = options;

  // The source is loaded through the bounded, Storage-aware server loader.
  // Keeping network access out of this renderer prevents callers from turning
  // persisted waiver metadata into an SSRF primitive.
  const pdfDoc = await loadSourceDocument(sourcePdfBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const encodable = new Set(font.getCharacterSet());
  const pagesWithSubstitutions = new Set<PDFPage>();

  // A field that names a page the document does not have is skipped.
  const pageFor = (pageIndex: number | null | undefined): PDFPage | null => {
    const index = pageIndex ?? 0;
    if (!Number.isInteger(index) || index < 0) return null;
    return pages[index] ?? null;
  };

  const drawText = (
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

  const drawSignedStamp = (page: PDFPage, rect: FieldRect, at: unknown) => {
    const signedAt = formatSignedAt(at, timeZone);
    if (!signedAt) return;
    drawText(page, `Signed: ${signedAt}`, {
      x: rect.x,
      y: rect.y - 12,
      size: 8,
      gray: true,
    });
  };

  // 2. Get signature placements from definition
  const signatureFields =
    definition.fields?.filter((f) => f.field_type === "signature") || [];

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
      const rect = usableRect(field.rect);
      if (!page || !rect) continue;

      // Handle typed signatures (draw text instead of image)
      if (signerSignature.method === "typed") {
        const fontSize = Math.max(6, Math.min(rect.height * 0.6, 24)); // Scale font to fit
        drawText(page, signatureData, {
          x: rect.x + 5,
          y: rect.y + rect.height / 2 - fontSize / 3,
          size: fontSize,
        });
        drawSignedStamp(page, rect, signerSignature.timestamp);
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
        safeConsole.error(
          "Application diagnostic from lib/waiver/generate-signed-waiver-pdf",
        );
        continue;
      }

      if (!signatureImage) continue;

      // Signature boxes detected from text baselines can be too small.
      // Enforce a sane minimum for image signatures while clamping to page bounds.
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      const minSigWidth = 180;
      const minSigHeight = 50;

      const desiredWidth = Math.max(rect.width, minSigWidth);
      const desiredHeight = Math.max(rect.height, minSigHeight);

      const finalWidth = Math.min(
        desiredWidth,
        Math.max(1, pageWidth - rect.x),
      );
      const finalHeight = Math.min(
        desiredHeight,
        Math.max(1, pageHeight - rect.y),
      );

      // Draw the signature
      page.drawImage(signatureImage, {
        x: rect.x,
        y: rect.y,
        width: finalWidth,
        height: finalHeight,
      });

      drawSignedStamp(page, rect, signerSignature.timestamp);
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

      drawText(page, Array.isArray(value) ? value.join(", ") : value, {
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
        drawText(page, "X", {
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
  const modifiedPdfBytes = await pdfDoc.save();
  return Buffer.from(modifiedPdfBytes);
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
