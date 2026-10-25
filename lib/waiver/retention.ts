/**
 * How long signed waivers are kept after their project is over.
 *
 * The waiver cleanup job reads this number, and the organizer-facing notice is
 * built from it, so the copy cannot promise a different period than the job
 * applies.
 *
 * "Over" is what the cleanup job measures: a completed project counts from the
 * end of its last scheduled session in the project's time zone, and a
 * cancelled project counts from the moment it was cancelled.
 */
export const SIGNED_WAIVER_RETENTION_DAYS = 30;

export const SIGNED_WAIVER_RETENTION_NOTICE = `Signed waivers are deleted ${SIGNED_WAIVER_RETENTION_DAYS} days after the project's last session ends, or ${SIGNED_WAIVER_RETENTION_DAYS} days after it is cancelled. Download any you need to keep before then.`;
