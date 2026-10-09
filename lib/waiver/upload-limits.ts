/**
 * What a volunteer may upload as their printed and signed waiver.
 *
 * The file picker, the client-side check, and the server all read these, so
 * the limit a person is told is the limit that is enforced.
 */

export const SIGNED_WAIVER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const SIGNED_WAIVER_UPLOAD_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

/** `accept` for the file picker. Extensions cover files with no reported type. */
export const SIGNED_WAIVER_UPLOAD_ACCEPT =
  "application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg";

export const SIGNED_WAIVER_TYPE_MESSAGE =
  "The signed waiver must be a PDF, PNG or JPEG file.";

export const SIGNED_WAIVER_SIZE_MESSAGE = `The signed waiver is too large. The limit is ${
  SIGNED_WAIVER_UPLOAD_MAX_BYTES / (1024 * 1024)
} MB.`;

export const SIGNED_WAIVER_UNREADABLE_MESSAGE =
  "The signed waiver file could not be read. Choose the file again.";

export const SIGNED_WAIVER_STORAGE_MESSAGE =
  "The signed waiver could not be saved. Please try again.";

export type WaiverUploadFailureReason = "invalid" | "type" | "size" | "storage";

/** The sentence shown for each reason a signed waiver upload is refused. */
export function signedWaiverUploadFailureMessage(
  reason: WaiverUploadFailureReason | undefined,
): string {
  if (reason === "type") return SIGNED_WAIVER_TYPE_MESSAGE;
  if (reason === "size") return SIGNED_WAIVER_SIZE_MESSAGE;
  if (reason === "invalid") return SIGNED_WAIVER_UNREADABLE_MESSAGE;
  return SIGNED_WAIVER_STORAGE_MESSAGE;
}

/**
 * Checks a chosen file before it is read and sent. Returns the reason it would
 * be refused, or null. The server repeats both checks on the real bytes.
 */
export function signedWaiverUploadProblem(file: {
  type: string;
  size: number;
}): string | null {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!(SIGNED_WAIVER_UPLOAD_TYPES as readonly string[]).includes(type)) {
    return SIGNED_WAIVER_TYPE_MESSAGE;
  }
  if (file.size > SIGNED_WAIVER_UPLOAD_MAX_BYTES) {
    return SIGNED_WAIVER_SIZE_MESSAGE;
  }
  return null;
}

/**
 * Multi-slot guest sign-up: the waiver travels with every slot until the
 * server has handed back a continuation token. Later slots then reuse the
 * stored evidence through that token. Sending it only with the first slot
 * loses the waiver whenever that slot is full or already past.
 */
export function shouldSendWaiverWithSlot(
  continuationToken: string | null | undefined,
): boolean {
  return !continuationToken;
}
