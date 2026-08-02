type RetryOptions = {
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
};

type SupabaseQueryErrorLike = {
	code?: string | null;
	message?: string | null;
	details?: string | null;
	hint?: string | null;
	/** Present on fetch/PostgREST-shaped errors that carry the HTTP status. */
	status?: number | string | null;
};

type SupabaseQueryResult<T> = {
	data: T | null;
	error: SupabaseQueryErrorLike | null;
};

const RETRYABLE_ERROR_CODES = new Set([
	"42P01",
	"PGRST001",
	"PGRST205",
]);

/**
 * SQLSTATE classes with no transient members.
 *
 * Class 42 is deliberately absent: 42P01 (undefined_table) is how a stale
 * PostgREST schema cache reports itself right after a migration, and that
 * clears on its own. Individual deterministic class-42 codes are listed below.
 */
const DETERMINISTIC_SQLSTATE_CLASSES = new Set([
	"22", // data exception
	"23", // integrity constraint violation
	"28", // invalid authorization specification
]);

const DETERMINISTIC_ERROR_CODES = new Set([
	"42501", // insufficient_privilege
	"42601", // syntax_error
	"42703", // undefined_column
	"42883", // undefined_function
	"42P02", // undefined_parameter
	"PGRST100", // parse error
	"PGRST101", // method not allowed
	"PGRST102", // invalid request body
	"PGRST103", // invalid range
	"PGRST106", // schema not exposed
	"PGRST116", // cardinality violation
	"PGRST301", // invalid or expired JWT
	"PGRST302", // anonymous access disabled
]);

/** Authorization, validation, and constraint wording that repeats identically. */
const DETERMINISTIC_MESSAGE_SIGNALS = [
	"permission denied",
	"insufficient privilege",
	"violates row-level security policy",
	"violates unique constraint",
	"violates foreign key constraint",
	"violates check constraint",
	"violates not-null constraint",
	"duplicate key value",
	"invalid input syntax",
	"jwt expired",
	"invalid jwt",
	"not authorized",
];

/** The 4xx codes a server uses to say "later", not "never". */
const TRANSIENT_CLIENT_HTTP_STATUSES = new Set([408, 425, 429]);

/**
 * A three-digit number counts as an HTTP status only when it directly follows
 * an explicit status keyword. Bounded on purpose: an unrelated number such as
 * the 404 in a table name must never be read as a response code.
 */
const HTTP_STATUS_PATTERNS = [
	/\bstatus(?:\s+code)?\s*[:=]?\s*(\d{3})\b/u,
	/\bhttp(?:\/\d(?:\.\d)?)?\s+(\d{3})\b/u,
];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toLower(value: unknown): string {
	return typeof value === "string" ? value.toLowerCase() : "";
}

/**
 * A cancelled request is a deliberate lifecycle decision, not a transport
 * fault. Retrying it would resurrect work the caller already abandoned.
 */
function isAbortedOperation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { name?: unknown }).name === "AbortError"
	);
}

function isDeterministicErrorCode(code: string): boolean {
	if (DETERMINISTIC_ERROR_CODES.has(code)) {
		return true;
	}

	// SQLSTATE is a two-character class followed by a three-character subclass.
	return (
		/^\d{2}/u.test(code) && DETERMINISTIC_SQLSTATE_CLASSES.has(code.slice(0, 2))
	);
}

function readHttpStatus(error: SupabaseQueryErrorLike, text: string): number | null {
	const declared = error.status;
	if (typeof declared === "number" && Number.isInteger(declared)) {
		return declared;
	}
	if (typeof declared === "string" && /^\d{3}$/u.test(declared.trim())) {
		return Number(declared.trim());
	}

	for (const pattern of HTTP_STATUS_PATTERNS) {
		const match = pattern.exec(text);
		if (match) {
			return Number(match[1]);
		}
	}

	return null;
}

/**
 * Classify a failure as deterministic (identical on every attempt), transient
 * (worth one more attempt), or unknown.
 *
 * Precedence matters. A deterministic failure frequently arrives wrapped in
 * transport wording — `permission denied: fetch failed` is still a permission
 * problem — so the deterministic signals are ruled out before any transient
 * phrase is consulted. Explicit error codes outrank an HTTP status, because
 * PostgREST answers a stale schema cache with 404 while still naming the
 * retryable code.
 */
function classifySupabaseQueryError(
	error: SupabaseQueryErrorLike,
): "deterministic" | "transient" | "unknown" {
	if (isAbortedOperation(error)) {
		return "deterministic";
	}

	const code = error.code?.trim();
	if (code && isDeterministicErrorCode(code)) {
		return "deterministic";
	}
	if (code && RETRYABLE_ERROR_CODES.has(code)) {
		return "transient";
	}

	const searchableText = [error.message, error.details, error.hint]
		.map(toLower)
		.join(" ");

	if (DETERMINISTIC_MESSAGE_SIGNALS.some((signal) => searchableText.includes(signal))) {
		return "deterministic";
	}

	const status = readHttpStatus(error, searchableText);
	if (status !== null) {
		if (status >= 400 && status <= 499) {
			return TRANSIENT_CLIENT_HTTP_STATUSES.has(status)
				? "transient"
				: "deterministic";
		}
		if (status >= 500 && status <= 599) {
			return "transient";
		}
	}

	const isTransientText =
		searchableText.includes("no connection to the server") ||
		searchableText.includes("schema cache") ||
		searchableText.includes("could not find the table") ||
		searchableText.includes("relation \"public.") ||
		searchableText.includes("database client error") ||
		searchableText.includes("invalid response was received from the upstream server") ||
		searchableText.includes("fetch failed") ||
		searchableText.includes("connection refused") ||
		searchableText.includes("timed out");

	return isTransientText ? "transient" : "unknown";
}

export function isRetryableSupabaseQueryError(error: SupabaseQueryErrorLike | null | undefined): boolean {
	if (!error) {
		return false;
	}

	return classifySupabaseQueryError(error) === "transient";
}

/**
 * Retry an **idempotent read** through a bounded, exponential backoff.
 *
 * This wrapper is for reads only. It classifies failures from the error value
 * alone and has no way to know what operation produced it: a thrown transport
 * failure such as `fetch failed`, `connection refused`, or `timed out` is
 * indistinguishable from the same failure raised *after* a write reached
 * Postgres. Wrapping an insert, update, upsert, delete, or a mutating RPC in
 * this helper can therefore apply it twice.
 *
 * Deterministic failures — authorization, RLS, validation, constraint
 * violations, and 4xx responses other than 408, 425, and 429 — are never
 * retried, and neither is an `AbortError`, because a cancelled request was
 * abandoned on purpose. Those signals take precedence over transient wording
 * that happens to appear in the same message.
 *
 * For a mutation, retry at a layer that knows the operation is safe to repeat
 * (an idempotency key, a natural unique key, or an explicit read-back).
 */
export async function withRetryableSupabaseQuery<TResult extends SupabaseQueryResult<unknown>>(
	query: () => PromiseLike<TResult> | TResult,
	options: RetryOptions = {},
): Promise<TResult> {
	const {
		maxAttempts = 3,
		initialDelayMs = 250,
		maxDelayMs = 1500,
	} = options;

	let lastResult: TResult | null = null;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			lastResult = await query();
		} catch (error) {
			const retryableError =
				error && typeof error === "object"
					? (error as SupabaseQueryErrorLike)
					: { message: String(error) };

			if (
				attempt >= maxAttempts ||
				!isRetryableSupabaseQueryError(retryableError)
			) {
				throw error;
			}

			const backoff = Math.min(
				maxDelayMs,
				initialDelayMs * 2 ** (attempt - 1),
			);
			await sleep(backoff);
			continue;
		}

		if (!lastResult.error || !isRetryableSupabaseQueryError(lastResult.error as SupabaseQueryErrorLike)) {
			return lastResult;
		}

		if (attempt < maxAttempts) {
			const backoff = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
			await sleep(backoff);
		}
	}

	return lastResult as TResult;
}
