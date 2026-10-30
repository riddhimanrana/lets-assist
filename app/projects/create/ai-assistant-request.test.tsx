import { describe, expect, test } from "bun:test";

import type { ParseProjectResult } from "@/lib/ai/parse-project-schema";

import {
  AI_ASSISTANT_MESSAGES,
  AI_ASSISTANT_TIMEOUT_MS,
  createAssistantRequestController,
  validateAssistantPrompt,
  type AssistantFailureKind,
  type AssistantFetch,
} from "./ai-assistant-request";
import { renderToStaticMarkup } from "react-dom/server";

import AIAssistant, {
  AI_APPLIED_MESSAGE,
  AI_APPLY_FAILED_MESSAGE,
  createAssistantPanelHandlers,
} from "./AIAssistant";

const PROMPT = "Beach cleanup Saturday 9am-12pm at Ocean Beach";

const validResult = {
  title: "Beach cleanup",
  location: "Ocean Beach",
  description: "Remove litter from the shoreline.",
  verificationMethod: "qr-code",
  requireLogin: true,
  recurrence: { enabled: false },
  eventType: "oneTime",
  schedule: {
    date: "2099-08-01",
    startTime: "09:00",
    endTime: "12:00",
    volunteers: 25,
  },
};

/** Timers that only fire when the test says so. */
function manualTimers() {
  let nextHandle = 0;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  return {
    setTimer: (callback: () => void, ms: number) => {
      const handle = ++nextHandle;
      pending.set(handle, { callback, ms });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number);
    },
    fireAll() {
      const due = [...pending.values()];
      pending.clear();
      for (const timer of due) timer.callback();
    },
    get size() {
      return pending.size;
    },
    get delays() {
      return [...pending.values()].map((timer) => timer.ms);
    },
  };
}

type Deferred = {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  init?: RequestInit;
};

/**
 * A fetch whose calls stay pending until the test settles them. It ignores
 * the abort signal on purpose, like a stalled connection or a fetch shim that
 * never rejects, so only the controller can unblock the assistant.
 */
function stalledFetch() {
  const calls: Deferred[] = [];
  const fetchImpl: AssistantFetch = (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ resolve, reject, init });
    });
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Let pending promise callbacks run. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function recorder() {
  const successes: ParseProjectResult[] = [];
  const failures: Array<{ reason: AssistantFailureKind; message: string }> = [];
  return {
    successes,
    failures,
    callbacks: {
      onSuccess: (data: ParseProjectResult) => successes.push(data),
      onFailure: (reason: AssistantFailureKind, message: string) =>
        failures.push({ reason, message }),
    },
  };
}

describe("assistant prompt validation", () => {
  test("keeps the 10 to 4,000 trimmed character bounds", () => {
    expect(validateAssistantPrompt("too short")).toBe(
      AI_ASSISTANT_MESSAGES.invalidPrompt,
    );
    expect(validateAssistantPrompt(`   ${"a".repeat(9)}   `)).toBe(
      AI_ASSISTANT_MESSAGES.invalidPrompt,
    );
    expect(validateAssistantPrompt("a".repeat(10))).toBeNull();
    expect(validateAssistantPrompt("a".repeat(4_000))).toBeNull();
    expect(validateAssistantPrompt("a".repeat(4_001))).toBe(
      AI_ASSISTANT_MESSAGES.invalidPrompt,
    );
  });

  test("an invalid prompt never reaches the network", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const record = recorder();
    await controller.start("short", undefined, record.callbacks);
    expect(calls).toHaveLength(0);
    expect(timers.size).toBe(0);
    expect(record.failures).toEqual([
      {
        reason: "invalid-prompt",
        message: AI_ASSISTANT_MESSAGES.invalidPrompt,
      },
    ]);
  });
});

describe("assistant request lifecycle", () => {
  test("a stalled request stays pending until the finite timeout", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const record = recorder();

    const settled = controller.start(PROMPT, undefined, record.callbacks);
    await flush();

    // The stall: the fetch never answers and nothing else would end it.
    expect(calls).toHaveLength(1);
    expect(controller.isPending()).toBe(true);
    expect(record.failures).toHaveLength(0);
    expect(timers.delays).toEqual([AI_ASSISTANT_TIMEOUT_MS]);

    timers.fireAll();
    await settled;

    expect(controller.isPending()).toBe(false);
    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(record.failures).toEqual([
      { reason: "timeout", message: AI_ASSISTANT_MESSAGES.timeout },
    ]);
    expect(record.successes).toHaveLength(0);
  });

  test("the timeout is a finite, bounded wait", () => {
    expect(Number.isFinite(AI_ASSISTANT_TIMEOUT_MS)).toBe(true);
    expect(AI_ASSISTANT_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(AI_ASSISTANT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  test("a response that arrives after the timeout is dropped", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const record = recorder();

    const settled = controller.start(PROMPT, undefined, record.callbacks);
    await flush();
    timers.fireAll();
    await settled;

    calls[0].resolve(json(validResult));
    await flush();

    expect(record.successes).toHaveLength(0);
    expect(record.failures.map((failure) => failure.reason)).toEqual([
      "timeout",
    ]);
  });

  test("cancel aborts the fetch, reports nothing and drops a late answer", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const record = recorder();

    const settled = controller.start(PROMPT, undefined, record.callbacks);
    await flush();
    controller.cancel();
    await settled;

    expect(controller.isPending()).toBe(false);
    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(timers.size).toBe(0);

    calls[0].resolve(json(validResult));
    await flush();
    timers.fireAll();

    expect(record.successes).toHaveLength(0);
    expect(record.failures).toHaveLength(0);
  });

  test("a newer request is never reset or overwritten by the one it replaced", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const first = recorder();
    const second = recorder();

    const firstSettled = controller.start(PROMPT, undefined, first.callbacks);
    await flush();
    const secondSettled = controller.start(
      `${PROMPT} with lunch`,
      undefined,
      second.callbacks,
    );
    await flush();
    await firstSettled;

    expect(calls).toHaveLength(2);
    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(calls[1].init?.signal?.aborted).toBe(false);
    // Only the live request's timeout remains.
    expect(timers.size).toBe(1);

    // The replaced request answers late, with an error and then data.
    calls[0].reject(new TypeError("fetch failed"));
    await flush();
    expect(controller.isPending()).toBe(true);
    expect(first.failures).toHaveLength(0);

    calls[1].resolve(json(validResult));
    await secondSettled;

    expect(controller.isPending()).toBe(false);
    expect(second.successes).toHaveLength(1);
    expect(first.successes).toHaveLength(0);
    expect(timers.size).toBe(0);
  });

  test("an invalid start still retires the live request", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const first = recorder();
    const settled = controller.start(PROMPT, undefined, first.callbacks);
    await flush();

    const second = recorder();
    await controller.start("tiny", undefined, second.callbacks);
    await settled;

    expect(controller.isPending()).toBe(false);
    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(timers.size).toBe(0);
    expect(second.failures.map((failure) => failure.reason)).toEqual([
      "invalid-prompt",
    ]);
    calls[0].resolve(json(validResult));
    await flush();
    expect(first.successes).toHaveLength(0);
    expect(first.failures).toHaveLength(0);
  });

  test("a failed response shows the server message and keeps nothing pending", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const record = recorder();

    const settled = controller.start(PROMPT, undefined, record.callbacks);
    await flush();
    calls[0].resolve(
      json({ error: "Too many project-assistant requests." }, 429),
    );
    await settled;

    expect(record.failures).toEqual([
      { reason: "server", message: "Too many project-assistant requests." },
    ]);
    expect(timers.size).toBe(0);
  });

  test("a failed response without a readable body falls back to plain copy", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...manualTimers(),
    });
    const record = recorder();

    const settled = controller.start(PROMPT, undefined, record.callbacks);
    await flush();
    calls[0].resolve(new Response("<html>Bad gateway</html>", { status: 502 }));
    await settled;

    expect(record.failures).toEqual([
      { reason: "server", message: AI_ASSISTANT_MESSAGES.unavailable },
    ]);
  });

  test("a network failure is reported as a network error", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...manualTimers(),
    });
    const record = recorder();

    const settled = controller.start(PROMPT, undefined, record.callbacks);
    await flush();
    calls[0].reject(new TypeError("Failed to fetch"));
    await settled;

    expect(record.failures).toEqual([
      { reason: "network", message: AI_ASSISTANT_MESSAGES.network },
    ]);
  });

  for (const [name, response] of [
    ["unparseable JSON", () => new Response("{not json", { status: 200 })],
    ["the wrong shape", () => json({ title: "Only a title" })],
  ] as const) {
    test(`a success response with ${name} is malformed, not applied`, async () => {
      const { fetchImpl, calls } = stalledFetch();
      const controller = createAssistantRequestController({
        fetchImpl,
        ...manualTimers(),
      });
      const record = recorder();

      const settled = controller.start(PROMPT, undefined, record.callbacks);
      await flush();
      calls[0].resolve(response());
      await settled;

      expect(record.successes).toHaveLength(0);
      expect(record.failures).toEqual([
        { reason: "malformed", message: AI_ASSISTANT_MESSAGES.malformed },
      ]);
    });
  }

  test("a body that stalls after the headers still times out", async () => {
    const timers = manualTimers();
    const stalledBody = new Response(
      new ReadableStream({
        start() {
          // Never enqueue or close.
        },
      }),
      { status: 200 },
    );
    const controller = createAssistantRequestController({
      fetchImpl: async () => stalledBody,
      ...timers,
    });
    const record = recorder();

    const settled = controller.start(PROMPT, undefined, record.callbacks);
    await flush();
    expect(controller.isPending()).toBe(true);
    timers.fireAll();
    await settled;

    expect(record.failures.map((failure) => failure.reason)).toEqual([
      "timeout",
    ]);
  });

  test("sends the trimmed prompt and the project timezone", async () => {
    const { fetchImpl, calls } = stalledFetch();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...manualTimers(),
    });

    void controller.start(
      `  ${PROMPT}  `,
      "America/Los_Angeles",
      recorder().callbacks,
    );
    void controller.start(PROMPT, undefined, recorder().callbacks);
    await flush();

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      prompt: PROMPT,
      timezone: "America/Los_Angeles",
    });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ prompt: PROMPT });
    controller.cancel();
  });
});

describe("assistant panel handlers", () => {
  function panel(
    options: {
      onApplyData?: (data: ParseProjectResult) => void;
      prompt?: string;
    } = {},
  ) {
    const { fetchImpl, calls } = stalledFetch();
    const timers = manualTimers();
    const controller = createAssistantRequestController({
      fetchImpl,
      ...timers,
    });
    const state = {
      prompt: options.prompt ?? PROMPT,
      pending: false,
      error: null as string | null,
      applied: [] as ParseProjectResult[],
      closes: 0,
      toasts: [] as string[],
    };
    const handlers = createAssistantPanelHandlers({
      controller,
      getPrompt: () => state.prompt,
      projectTimezone: "America/Los_Angeles",
      onApplyData:
        options.onApplyData ?? ((data) => void state.applied.push(data)),
      onClose: () => {
        state.closes += 1;
      },
      setPrompt: (prompt) => {
        state.prompt = prompt;
      },
      setPending: (pending) => {
        state.pending = pending;
      },
      setError: (error) => {
        state.error = error;
      },
      notify: { success: (message) => void state.toasts.push(message) },
    });
    return { handlers, controller, calls, timers, state };
  }

  test("a successful answer fills the form once, then clears and closes", async () => {
    const { handlers, calls, state } = panel();
    const run = handlers.generate();
    await flush();
    expect(state.pending).toBe(true);

    calls[0].resolve(json(validResult));
    await run;

    expect(state.applied).toHaveLength(1);
    expect(state.applied[0].title).toBe("Beach cleanup");
    expect(state.toasts).toEqual([AI_APPLIED_MESSAGE]);
    expect(state.prompt).toBe("");
    expect(state.pending).toBe(false);
    expect(state.closes).toBe(1);
  });

  test("a timeout keeps the prompt editable with a recoverable message", async () => {
    const { handlers, timers, state } = panel();
    const run = handlers.generate();
    await flush();
    timers.fireAll();
    await run;

    expect(state.pending).toBe(false);
    expect(state.prompt).toBe(PROMPT);
    expect(state.error).toBe(AI_ASSISTANT_MESSAGES.timeout);
    expect(state.applied).toHaveLength(0);
    expect(state.closes).toBe(0);
  });

  test("cancel while pending restores the prompt and ignores the late answer", async () => {
    const { handlers, calls, state } = panel();
    const run = handlers.generate();
    await flush();
    handlers.cancel();
    await run;

    expect(state.pending).toBe(false);
    expect(state.prompt).toBe(PROMPT);
    expect(state.error).toBeNull();

    calls[0].resolve(json(validResult));
    await flush();
    expect(state.applied).toHaveLength(0);
    expect(state.closes).toBe(0);
  });

  test("closing while pending cancels the request and never applies later", async () => {
    const { handlers, controller, calls, state } = panel();
    const run = handlers.generate();
    await flush();
    handlers.close();
    await run;

    expect(controller.isPending()).toBe(false);
    expect(state.closes).toBe(1);
    calls[0].resolve(json(validResult));
    await flush();
    expect(state.applied).toHaveLength(0);
    expect(state.toasts).toHaveLength(0);
    expect(state.closes).toBe(1);
  });

  test("unmount cleanup, which calls cancel, blocks a delayed apply", async () => {
    const { handlers, controller, calls, state } = panel();
    const run = handlers.generate();
    await flush();
    controller.cancel();
    await run;

    calls[0].resolve(json(validResult));
    await flush();
    expect(state.applied).toHaveLength(0);
    expect(state.closes).toBe(0);
  });

  test("cancel then reopen: only the new request can fill the form", async () => {
    const { handlers, calls, state } = panel();
    const first = handlers.generate();
    await flush();
    handlers.cancel();
    await first;

    const second = handlers.generate();
    await flush();
    // The first request finally answers while the second is pending.
    calls[0].resolve(json({ ...validResult, title: "Stale" }));
    await flush();
    expect(state.pending).toBe(true);
    expect(state.applied).toHaveLength(0);

    calls[1].resolve(json(validResult));
    await second;
    expect(state.applied.map((data) => data.title)).toEqual(["Beach cleanup"]);
    expect(state.closes).toBe(1);
  });

  test("retry after a failure succeeds and clears the old error", async () => {
    const { handlers, calls, state } = panel();
    const first = handlers.generate();
    await flush();
    calls[0].resolve(json({ error: "Project assistant is busy." }, 503));
    await first;
    expect(state.error).toBe("Project assistant is busy.");
    expect(state.prompt).toBe(PROMPT);

    const retry = handlers.generate();
    expect(state.error).toBeNull();
    await flush();
    calls[1].resolve(json(validResult));
    await retry;

    expect(state.applied).toHaveLength(1);
    expect(state.error).toBeNull();
  });

  test("an apply that throws keeps the prompt and the panel open", async () => {
    const { handlers, calls, state } = panel({
      onApplyData: () => {
        throw new Error("form rejected the data");
      },
    });
    const run = handlers.generate();
    await flush();
    calls[0].resolve(json(validResult));
    await run;

    expect(state.error).toBe(AI_APPLY_FAILED_MESSAGE);
    expect(state.prompt).toBe(PROMPT);
    expect(state.closes).toBe(0);
    expect(state.toasts).toHaveLength(0);
  });

  test("an invalid prompt shows the bounds message without a request", async () => {
    const { handlers, calls, state } = panel({ prompt: "tiny" });
    await handlers.generate();
    expect(calls).toHaveLength(0);
    expect(state.pending).toBe(false);
    expect(state.error).toBe(AI_ASSISTANT_MESSAGES.invalidPrompt);
  });
});

describe("assistant panel render", () => {
  const render = (isOpen: boolean) =>
    renderToStaticMarkup(
      <AIAssistant
        isOpen={isOpen}
        onApplyData={() => {
          throw new Error("Rendering must not apply data");
        }}
        onClose={() => {
          throw new Error("Rendering must not close");
        }}
      />,
    );

  test("a closed assistant renders nothing, so no request can outlive it", () => {
    expect(render(false)).toBe("");
  });

  test("the open assistant keeps Close and the prompt usable", () => {
    const html = render(true);
    const close = /<button[^>]*aria-label="Close AI assistant"[^>]*>/u.exec(
      html,
    )?.[0];
    expect(close).toBeDefined();
    // Attributes, not the `disabled:` utility classes every button carries.
    expect(close).not.toMatch(/\sdisabled(=|\s|>)/u);
    expect(close).not.toContain("aria-disabled");
    const textarea = /<textarea[^>]*>/u.exec(html)?.[0] ?? "";
    expect(textarea).not.toMatch(/\s(disabled|readonly)(=|\s|>)/u);
    expect(html).toContain('aria-busy="false"');
    // Nothing is pending on first render, so Cancel is not offered yet.
    expect(html).not.toContain(">Cancel<");
  });
});
