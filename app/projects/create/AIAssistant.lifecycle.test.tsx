/**
 * Real React lifecycle proof for the project assistant: the actual component
 * mounts with react-dom/client on a minimal DOM, and the parent closes it the
 * way the create-project header toggle does, by flipping `isOpen`. No browser,
 * provider or backend is involved; fetch and timers are fakes.
 */
import { describe, expect, mock, test } from "bun:test";

import {
  fireEvent,
  installMinimalDom,
  type MinimalElement,
  type MinimalFormElement,
} from "@/tests/support/minimal-dom";

const { document } = installMinimalDom();

mock.module("@/components/icons/animated", () => ({
  SparklesIcon: () => null,
  useAnimatedIcon: () => ({ ref: null, triggerProps: {} }),
}));
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: { success: (message: string) => void toasts.push(message) },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: AIAssistant } = await import("./AIAssistant");
const { AI_ASSISTANT_MESSAGES } = await import("./ai-assistant-request");

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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function fixture() {
  const calls: Array<{
    resolve: (response: Response) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal | null;
  }> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const applied: unknown[] = [];
  let closes = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);

  const requestDeps = {
    fetchImpl: (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ resolve, reject, signal: init.signal });
      }),
    setTimer: (callback: () => void) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
  };

  const render = (isOpen: boolean) =>
    act(() => {
      root.render(
        <AIAssistant
          isOpen={isOpen}
          onApplyData={(data) => void applied.push(data)}
          onClose={() => {
            closes += 1;
          }}
          requestDeps={requestDeps}
        />,
      );
    });

  const el = (predicate: (element: MinimalElement) => boolean) =>
    (container as unknown as MinimalElement).find(predicate);
  const textarea = () =>
    el((e) => e.tagName === "TEXTAREA") as MinimalFormElement | null;
  const button = (text: string) =>
    el(
      (e) =>
        e.tagName === "BUTTON" &&
        (e.textContent.includes(text) || e.getAttribute("aria-label") === text),
    ) as MinimalFormElement | null;

  const type = (value: string) =>
    act(() => {
      const node = textarea();
      if (!node) throw new Error("No prompt field");
      // Write through the prototype setter so React's value tracker sees a change.
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(node),
        "value",
      )?.set?.call(node, value);
      fireEvent(node, "input");
    });
  const click = (text: string) =>
    act(() => {
      const node = button(text);
      if (!node) throw new Error(`No button ${text}`);
      fireEvent(node, "click");
    });
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

  return {
    calls,
    timers,
    applied,
    get closes() {
      return closes;
    },
    container,
    render,
    textarea,
    button,
    type,
    click,
    settle,
    unmount: () => act(() => root.unmount()),
  };
}

describe("project assistant React lifecycle", () => {
  test("closing from the parent while pending cancels, and the late answer applies nothing", async () => {
    const f = fixture();
    await f.render(true);
    await f.type(PROMPT);
    await f.click("Generate project details");
    await f.settle();

    expect(f.calls).toHaveLength(1);
    expect(f.textarea()?.readOnly).toBe(true);
    // Close and Cancel stay enabled while the request is pending.
    expect(f.button("Close AI assistant")?.disabled).toBe(false);
    expect(f.button("Cancel")?.disabled).toBe(false);

    // The header toggle closes the assistant without its own handlers.
    await f.render(false);
    expect(f.textarea()).toBeNull();
    expect(f.calls[0].signal?.aborted).toBe(true);
    expect(f.timers.size).toBe(0);

    f.calls[0].resolve(json(validResult));
    await f.settle();
    expect(f.applied).toHaveLength(0);

    // Reopening keeps the prompt, editable, with nothing pending.
    await f.render(true);
    expect(f.textarea()?.value).toBe(PROMPT);
    expect(f.textarea()?.readOnly).toBe(false);
    expect(f.button("Cancel")).toBeNull();
    await f.settle();
    expect(f.applied).toHaveLength(0);
    await f.unmount();
  });

  test("unmounting the page while pending cancels, and the late answer applies nothing", async () => {
    const f = fixture();
    await f.render(true);
    await f.type(PROMPT);
    await f.click("Generate project details");
    await f.settle();

    await f.unmount();
    expect(f.calls[0].signal?.aborted).toBe(true);
    f.calls[0].resolve(json(validResult));
    await f.settle();
    expect(f.applied).toHaveLength(0);
  });

  test("Cancel restores an editable prompt and drops the late answer", async () => {
    const f = fixture();
    await f.render(true);
    await f.type(PROMPT);
    await f.click("Generate project details");
    await f.settle();
    await f.click("Cancel");

    expect(f.textarea()?.readOnly).toBe(false);
    expect(f.textarea()?.value).toBe(PROMPT);
    expect(f.button("Cancel")).toBeNull();
    f.calls[0].resolve(json(validResult));
    await f.settle();
    expect(f.applied).toHaveLength(0);
    await f.unmount();
  });

  test("Escape cancels a pending request", async () => {
    const f = fixture();
    await f.render(true);
    await f.type(PROMPT);
    await f.click("Generate project details");
    await f.settle();

    await act(() => {
      const node = f.textarea();
      if (node) fireEvent(node, "keydown", { key: "Escape" });
    });
    expect(f.calls[0].signal?.aborted).toBe(true);
    expect(f.textarea()?.readOnly).toBe(false);
    await f.unmount();
  });

  test("a timeout shows an inline message and keeps the prompt", async () => {
    const f = fixture();
    await f.render(true);
    await f.type(PROMPT);
    await f.click("Generate project details");
    await f.settle();

    await act(() => {
      for (const callback of [...f.timers.values()]) callback();
    });
    await f.settle();
    const alert = (f.container as unknown as MinimalElement).find(
      (e) => e.getAttribute("role") === "alert",
    );
    expect(alert?.textContent).toBe(AI_ASSISTANT_MESSAGES.timeout);
    expect(f.textarea()?.value).toBe(PROMPT);
    expect(f.textarea()?.readOnly).toBe(false);
    await f.unmount();
  });

  test("a success fills the form once, clears the prompt and closes", async () => {
    const f = fixture();
    await f.render(true);
    await f.type(PROMPT);
    await f.click("Generate project details");
    await f.settle();
    f.calls[0].resolve(json(validResult));
    await f.settle();

    expect(f.applied).toHaveLength(1);
    expect(f.closes).toBe(1);
    expect(toasts.at(-1)).toContain("Review and adjust");
    await f.unmount();
  });
});
