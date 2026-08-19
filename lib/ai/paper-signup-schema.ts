import { z } from "zod";

/**
 * Structured output contract for paper signup sheet extraction.
 *
 * Confidence is tracked per field, not just per row: the review table has to
 * highlight exactly which cell is doubtful, and a row can have a crisp name
 * next to an unreadable email.
 *
 * Times are loose "HH:MM"-ish strings, never timestamps: the model has no
 * reliable notion of the event's date or timezone. The server composes real
 * instants from the resolved slot window (lib/projects/paper-signup/normalize).
 */

export const paperSignupFieldSchema = z.object({
  value: z.string().max(320).nullable(),
  confidence: z.number().min(0).max(1),
});

export const paperSignupRowSchema = z.object({
  sheetRowNumber: z.number().int().min(1),
  name: paperSignupFieldSchema,
  email: paperSignupFieldSchema,
  phone: paperSignupFieldSchema,
  timeIn: paperSignupFieldSchema,
  timeOut: paperSignupFieldSchema,
  signaturePresent: z.boolean(),
  rowConfidence: z.number().min(0).max(1),
  notes: z.string().max(200).optional(),
});

export const paperSignupExtractionSchema = z.object({
  sheetLegible: z.boolean(),
  detectedColumns: z.array(z.string().max(80)).max(12),
  rows: z.array(paperSignupRowSchema).max(60),
});

export type PaperSignupField = z.infer<typeof paperSignupFieldSchema>;
export type PaperSignupRow = z.infer<typeof paperSignupRowSchema>;
export type PaperSignupExtraction = z.infer<typeof paperSignupExtractionSchema>;

/** Maximum photos per scan batch (also a CHECK on the batches table). */
export const PAPER_SCAN_MAX_IMAGES = 10;
/** Maximum staged rows a single batch may commit. */
export const PAPER_SCAN_MAX_ROWS_PER_BATCH = 300;
/** Server-side per-image byte cap (also the bucket file_size_limit). */
export const PAPER_SCAN_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Escalation predicate for the tiered model strategy. Runs on the cheap
 * tier's output; when true, the image is re-run on the stronger tier and
 * that result is taken wholesale.
 */
export function shouldEscalatePaperScan(
  extraction: PaperSignupExtraction,
): boolean {
  if (!extraction.sheetLegible) return true;
  if (extraction.rows.length === 0) return true;

  const lowConfidenceRows = extraction.rows.filter(
    (row) => row.rowConfidence < 0.7,
  ).length;
  if (lowConfidenceRows / extraction.rows.length > 0.25) return true;

  return extraction.rows.some(
    (row) =>
      row.name.confidence < 0.6 ||
      (row.email.value !== null && row.email.confidence < 0.6),
  );
}
