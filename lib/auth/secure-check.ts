/**
 * Decision logic for the Turnstile ("secure check") widget lifecycle.
 *
 * The widget can fail to initialize for reasons the app cannot detect directly:
 * an ad blocker or privacy extension removes the script, a corporate network
 * blocks `challenges.cloudflare.com`, or the connection drops mid-load. When
 * that happens no callback ever fires, so the UI must stop waiting on its own
 * instead of claiming the check is "almost ready" forever.
 *
 * These helpers are intentionally pure so the timing and phase decisions can be
 * tested without React or fake timers.
 */

/**
 * How long to wait for the widget before telling the person it did not load.
 *
 * Cloudflare's script normally resolves in well under two seconds, and its own
 * slow-network budget sits around five to eight seconds. Ten seconds clears a
 * genuinely slow connection while staying inside the window where a person is
 * still waiting rather than assuming the page is broken.
 */
export const SECURE_CHECK_TIMEOUT_MS = 10_000;

export type SecureCheckPhase = "loading" | "ready" | "unavailable";

export interface SecureCheckPhaseInput {
  /** The Turnstile script reported itself loaded (`onLoad`). */
  isReady: boolean;
  /** The widget reported an error before it ever became ready. */
  hasErrored?: boolean;
  /** The bounded wait elapsed without the widget becoming ready. */
  timedOut?: boolean;
}

/**
 * Resolve what the interface should show for the secure check.
 *
 * `ready` always wins: once the script has loaded, later challenge errors are
 * the widget's own business and it renders its own retry affordance.
 */
export function resolveSecureCheckPhase({
  isReady,
  hasErrored = false,
  timedOut = false,
}: SecureCheckPhaseInput): SecureCheckPhase {
  if (isReady) {
    return "ready";
  }

  if (hasErrored || timedOut) {
    return "unavailable";
  }

  return "loading";
}

/**
 * Whether the bounded wait has expired.
 */
export function hasSecureCheckTimedOut(
  elapsedMs: number,
  timeoutMs: number = SECURE_CHECK_TIMEOUT_MS,
): boolean {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(timeoutMs)) {
    return false;
  }

  return elapsedMs >= timeoutMs;
}

/**
 * Milliseconds left before the wait should be abandoned, or `null` when no
 * timer is needed (already ready, already failed, or already expired).
 */
export function secureCheckWatchdogDelayMs(
  input: SecureCheckPhaseInput & { elapsedMs?: number; timeoutMs?: number },
): number | null {
  const {
    elapsedMs = 0,
    timeoutMs = SECURE_CHECK_TIMEOUT_MS,
    isReady,
    hasErrored = false,
  } = input;

  if (isReady || hasErrored) {
    return null;
  }

  if (hasSecureCheckTimedOut(elapsedMs, timeoutMs)) {
    return null;
  }

  return Math.max(0, timeoutMs - Math.max(0, elapsedMs));
}

/**
 * Whether a submit control should stay disabled because the secure check has
 * not settled yet. A settled check — ready or unavailable — never blocks the
 * control, so the disabled state always maps to something the person can see.
 */
export function isSecureCheckBlockingSubmit(phase: SecureCheckPhase): boolean {
  return phase === "loading";
}

/**
 * Whether a retry needs to drop the previously injected Turnstile script tag.
 *
 * `@marsidev/react-turnstile` only injects its script when no tag with its id
 * exists. If the first injection was blocked, the dead tag stays in the DOM and
 * remounting the widget alone would never fetch the script again.
 */
export function shouldReinjectTurnstileScript(input: {
  hasScriptTag: boolean;
  hasTurnstileGlobal: boolean;
}): boolean {
  return input.hasScriptTag && !input.hasTurnstileGlobal;
}

/** Copy for the state where the widget never loaded. */
export const SECURE_CHECK_UNAVAILABLE_COPY = {
  title: "Security check didn't load",
  description:
    "An ad blocker, privacy extension, or restricted network usually blocks challenges.cloudflare.com. Allow that domain or switch networks, then retry.",
  retryLabel: "Retry",
} as const;
