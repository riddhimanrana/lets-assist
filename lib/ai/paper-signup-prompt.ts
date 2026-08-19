/**
 * Extraction prompt for paper signup sheets.
 *
 * The anti-hallucination clauses are the load-bearing part: the failure mode
 * that actually harms users is a confidently-invented email address, which
 * would mint a real anonymous signup, a real email, and a real certificate
 * for a stranger. A null with confidence 0 is always the correct answer for
 * anything the model cannot literally read.
 */

export interface PaperSignupPromptContext {
  projectTitle: string;
  slotLabel: string;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
  timezone: string;
}

export function buildPaperSignupExtractionPrompt(
  context: PaperSignupPromptContext,
): string {
  const { projectTitle, slotLabel, slotDate, slotStart, slotEnd, timezone } =
    context;

  return `You are transcribing one photographed page of a handwritten paper volunteer signup sheet.

Event context (use ONLY to sanity-check what you read, never to invent values):
- Event: ${projectTitle}
- Slot: ${slotLabel}, ${slotDate} from ${slotStart} to ${slotEnd} (${timezone})

TRANSCRIBE, DO NOT INFER.

1. Return one entry per handwritten data row, top to bottom. sheetRowNumber
   starts at 1 for the first data row below the header. Skip the header row
   and fully blank rows.
2. If a cell is empty, unreadable, or the sheet has no such column, return
   value: null with confidence 0. NEVER guess a plausible name, email, or
   phone number. A null is correct; a fabricated value is a data-integrity
   failure the organizer may not catch.
3. confidence is your certainty that you transcribed the written characters
   correctly, NOT that the value looks valid. Cursive, overwriting, or a
   smudge lowers it.
4. Emails: transcribe exactly as written, lowercased. Handwritten "@" and "."
   are often ambiguous; if the domain is unclear, lower the confidence rather
   than completing it to a common domain. Do not "correct" gmial to gmail.
5. Times: return them as written, e.g. "9", "9am", "9:30 AM", "14:00". If a
   time is outside ${slotStart}-${slotEnd}, still transcribe what is written
   and lower its confidence. Never substitute the scheduled time for an
   unreadable one.
6. signaturePresent: true only if there are visible ink marks in that row's
   signature column. If the sheet has no signature column, return false for
   every row.
7. detectedColumns: the column headers you can read, left to right.
8. If the photo is too blurry, cropped, or rotated to read reliably, set
   sheetLegible: false and still return whatever rows you can read.`;
}
