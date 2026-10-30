import {
  parseProjectOutputSchema,
  type ParseProjectResult,
} from "@/lib/ai/parse-project-schema";

/**
 * Request lifecycle for the project assistant, kept free of React so tests can
 * drive it with a stalled fetch and manual timers.
 *
 * At most one request is live. Starting a new one, cancelling, closing, or
 * unmounting retires the previous request: its fetch is aborted and any late
 * result is dropped, so it can never apply data or reset a newer request.
 */

export const AI_ASSISTANT_TIMEOUT_MS = 45_000;
export const AI_ASSISTANT_PROMPT_MIN = 10;
export const AI_ASSISTANT_PROMPT_MAX = 4_000;

export const AI_ASSISTANT_MESSAGES = {
  invalidPrompt: "Project description must be between 10 and 4,000 characters.",
  timeout:
    "The assistant took too long to respond. Your description is still here, so you can try again.",
  network: "Network error. Check your connection and try again.",
  malformed: "Could not understand your description. Try rephrasing it.",
  unavailable:
    "Project assistant is temporarily unavailable. Please try again.",
} as const;

export type AssistantFailureKind =
  "invalid-prompt" | "timeout" | "network" | "malformed" | "server";

export type AssistantOutcome =
  | { kind: "success"; data: ParseProjectResult }
  | { kind: "failure"; reason: AssistantFailureKind; message: string };

export type AssistantRequestCallbacks = {
  /** Only called for the live request, never after cancel or a newer start. */
  onSuccess: (data: ParseProjectResult) => void;
  onFailure: (reason: AssistantFailureKind, message: string) => void;
};

type TimerHandle = unknown;

/** The part of `fetch` the assistant uses. */
export type AssistantFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type AssistantRequestDeps = {
  fetchImpl?: AssistantFetch;
  timeoutMs?: number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

/** Returns an error message, or null when the trimmed prompt is in bounds. */
export function validateAssistantPrompt(prompt: string): string | null {
  const length = prompt.trim().length;
  return length < AI_ASSISTANT_PROMPT_MIN || length > AI_ASSISTANT_PROMPT_MAX
    ? AI_ASSISTANT_MESSAGES.invalidPrompt
    : null;
}

class RequestStopped extends Error {
  constructor(readonly reason: "timeout" | "cancelled") {
    super(reason);
  }
}

/**
 * Settles with `work`, or rejects as soon as `signal` aborts. A fetch that
 * ignores its signal, or a body that never finishes, still cannot hold the
 * assistant busy past the timeout.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function requestProjectParse(
  prompt: string,
  timezone: string | undefined,
  signal: AbortSignal,
  fetchImpl: AssistantFetch,
): Promise<AssistantOutcome> {
  let response: Response;
  try {
    response = await untilAborted(
      fetchImpl("/api/ai/parse-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ...(timezone ? { timezone } : {}),
        }),
        signal,
      }),
      signal,
    );
  } catch (error) {
    if (error instanceof RequestStopped) throw error;
    return {
      kind: "failure",
      reason: "network",
      message: AI_ASSISTANT_MESSAGES.network,
    };
  }

  if (!response.ok) {
    const body = await untilAborted(readJson(response), signal).catch(
      (error: unknown) => {
        if (error instanceof RequestStopped) throw error;
        return null;
      },
    );
    const serverMessage =
      body && typeof body === "object" && "error" in body
        ? (body as { error: unknown }).error
        : undefined;
    return {
      kind: "failure",
      reason: "server",
      message:
        typeof serverMessage === "string" && serverMessage.trim()
          ? serverMessage
          : AI_ASSISTANT_MESSAGES.unavailable,
    };
  }

  let body: unknown;
  try {
    body = await untilAborted(readJson(response), signal);
  } catch (error) {
    if (error instanceof RequestStopped) throw error;
    return {
      kind: "failure",
      reason: "malformed",
      message: AI_ASSISTANT_MESSAGES.malformed,
    };
  }

  const parsed = parseProjectOutputSchema.safeParse(body);
  return parsed.success
    ? { kind: "success", data: parsed.data }
    : {
        kind: "failure",
        reason: "malformed",
        message: AI_ASSISTANT_MESSAGES.malformed,
      };
}

export type AssistantRequestController = {
  /**
   * Starts a request, retiring any live one. Resolves once this request is
   * settled or retired. Callbacks fire only while it is still the live one.
   */
  start: (
    prompt: string,
    timezone: string | undefined,
    callbacks: AssistantRequestCallbacks,
  ) => Promise<void>;
  /** Retires the live request, if any. Safe to call repeatedly. */
  cancel: () => void;
  isPending: () => boolean;
};

export function createAssistantRequestController(
  deps: AssistantRequestDeps = {},
): AssistantRequestController {
  const fetchImpl: AssistantFetch =
    deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? AI_ASSISTANT_TIMEOUT_MS;
  const setTimer =
    deps.setTimer ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const clearTimer =
    deps.clearTimer ??
    ((handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let live: { id: number; abort: AbortController; timer: TimerHandle } | null =
    null;
  let nextId = 0;

  const retire = (reason: "timeout" | "cancelled") => {
    if (!live) return;
    const { abort, timer } = live;
    live = null;
    clearTimer(timer);
    abort.abort(new RequestStopped(reason));
  };

  return {
    isPending: () => live !== null,

    cancel: () => retire("cancelled"),

    async start(prompt, timezone, callbacks) {
      // Any start, valid or not, retires the live request first.
      retire("cancelled");
      const invalid = validateAssistantPrompt(prompt);
      if (invalid) {
        callbacks.onFailure("invalid-prompt", invalid);
        return;
      }

      const id = ++nextId;
      const abort = new AbortController();
      const timer = setTimer(() => {
        if (live?.id !== id) return;
        retire("timeout");
        callbacks.onFailure("timeout", AI_ASSISTANT_MESSAGES.timeout);
      }, timeoutMs);
      live = { id, abort, timer };

      let outcome: AssistantOutcome;
      try {
        outcome = await requestProjectParse(
          prompt,
          timezone,
          abort.signal,
          fetchImpl,
        );
      } catch {
        // Stopped by cancel or timeout. The timeout already reported itself.
        return;
      }

      // A late answer for a retired request is dropped here.
      if (live?.id !== id) return;
      live = null;
      clearTimer(timer);

      if (outcome.kind === "success") {
        callbacks.onSuccess(outcome.data);
      } else {
        callbacks.onFailure(outcome.reason, outcome.message);
      }
    },
  };
}
