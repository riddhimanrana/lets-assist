/**
 * The application already owns bounded, classified retries through
 * `withRetryableSupabaseQuery`. Keep the SDK's automatic GET/HEAD retry layer
 * disabled so one logical attempt cannot silently expand into nested retries.
 */
export const SUPABASE_DB_OPTIONS = Object.freeze({ retry: false });
