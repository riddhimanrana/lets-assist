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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toLower(value: unknown): string {
	return typeof value === "string" ? value.toLowerCase() : "";
}

export function isRetryableSupabaseQueryError(error: SupabaseQueryErrorLike | null | undefined): boolean {
	if (!error) {
		return false;
	}

	if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
		return true;
	}

	const searchableText = [error.message, error.details, error.hint]
		.map(toLower)
		.join(" ");

	return (
		searchableText.includes("no connection to the server") ||
		searchableText.includes("schema cache") ||
		searchableText.includes("could not find the table") ||
		searchableText.includes("relation \"public.") ||
		searchableText.includes("database client error") ||
		searchableText.includes("fetch failed") ||
		searchableText.includes("connection refused") ||
		searchableText.includes("timed out")
	);
}

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
		lastResult = await query();

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