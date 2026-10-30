/**
 * The real feedback form, mounted with react-dom/client on a minimal DOM. The
 * server action is replaced by a controllable fake, so no request leaves the
 * test. This proves handler and React state behavior, not browser layout.
 */
import { describe, expect, mock, test } from "bun:test";

import {
  fireEvent,
  installMinimalDom,
  type MinimalElement,
  type MinimalFormElement,
} from "@/tests/support/minimal-dom";

const { document } = installMinimalDom();

type Call = {
  input: { rating: number; comment: string | null };
  resolve: (value: { success: boolean; error?: string }) => void;
  reject: (error: unknown) => void;
};
const calls: Call[] = [];
mock.module("@/app/projects/[id]/actions", () => ({
  submitProjectFeedback: (input: Call["input"]) =>
    new Promise((resolve, reject) => {
      calls.push({ input, resolve, reject });
    }),
}));
const toasts: Array<{ kind: string; message: string }> = [];
mock.module("sonner", () => ({
  toast: {
    success: (message: string) =>
      void toasts.push({ kind: "success", message }),
    error: (message: string) => void toasts.push({ kind: "error", message }),
  },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ProjectFeedbackForm, FEEDBACK_OUTCOME_UNKNOWN_MESSAGE } =
  await import("./ProjectFeedbackForm");

function mount() {
  calls.length = 0;
  toasts.length = 0;
  const submitted: unknown[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const tree = container as unknown as MinimalElement;

  const find = (predicate: (element: MinimalElement) => boolean) =>
    tree.find(predicate);
  const button = (text: string) =>
    find(
      (e) => e.tagName === "BUTTON" && e.textContent.trim() === text,
    ) as MinimalFormElement | null;
  const textarea = () =>
    find((e) => e.tagName === "TEXTAREA") as MinimalFormElement | null;
  const checkedStar = () =>
    find(
      (e) =>
        e.getAttribute("role") === "radio" &&
        e.getAttribute("aria-checked") === "true",
    )?.getAttribute("aria-label");
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

  return {
    submitted,
    button,
    textarea,
    checkedStar,
    settle,
    alert: () => find((e) => e.getAttribute("role") === "alert"),
    render: () =>
      act(() => {
        root.render(
          <ProjectFeedbackForm
            projectId="00000000-0000-4000-8000-000000000001"
            signupId="00000000-0000-4000-8000-000000000002"
            initialRating={4}
            onSubmitted={(value) => void submitted.push(value)}
          />,
        );
      }),
    type: (value: string) =>
      act(() => {
        const node = textarea();
        if (!node) throw new Error("No comment field");
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(node),
          "value",
        )?.set?.call(node, value);
        fireEvent(node, "input");
      }),
    click: (text: string) =>
      act(() => {
        const node = button(text);
        if (!node) throw new Error(`No button ${text}`);
        fireEvent(node, "click");
      }),
    unmount: () => act(() => root.unmount()),
  };
}

describe("project feedback form submission", () => {
  test("a rejected action keeps the rating and comment and says the outcome is unknown", async () => {
    const f = mount();
    await f.render();
    await f.type("Clear instructions and a friendly team.");
    await f.click("Send feedback");
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toMatchObject({
      rating: 4,
      comment: "Clear instructions and a friendly team.",
    });

    await act(async () => {
      calls[0].reject(new TypeError("Failed to fetch"));
    });
    await f.settle();

    expect(f.alert()?.textContent).toBe(FEEDBACK_OUTCOME_UNKNOWN_MESSAGE);
    // Never claims a definite failure or a success.
    expect(toasts).toEqual([]);
    expect(f.submitted).toHaveLength(0);
    expect(f.textarea()?.value).toBe("Clear instructions and a friendly team.");
    expect(f.checkedStar()).toBe("4 stars");
    expect(f.button("Send feedback")?.disabled).toBe(false);
    expect(f.textarea()?.disabled).toBe(false);
    await f.unmount();
  });

  test("sending again after an unknown outcome succeeds and clears the message", async () => {
    const f = mount();
    await f.render();
    await f.click("Send feedback");
    await act(async () => calls[0].reject(new Error("response lost")));
    await f.settle();
    expect(f.alert()).not.toBeNull();

    await f.click("Send feedback");
    expect(calls).toHaveLength(2);
    expect(f.alert()).toBeNull();
    await act(async () => calls[1].resolve({ success: true }));
    await f.settle();

    expect(f.submitted).toEqual([{ rating: 4, comment: null }]);
    expect(toasts).toEqual([
      {
        kind: "success",
        message:
          "Thanks. Your feedback was sent to the people who manage this project.",
      },
    ]);
    expect(f.button("Edit feedback")).not.toBeNull();
    await f.unmount();
  });

  test("two quick clicks send one request", async () => {
    const f = mount();
    await f.render();
    await act(() => {
      const node = f.button("Send feedback");
      if (!node) throw new Error("No send button");
      fireEvent(node, "click");
      fireEvent(node, "click");
    });
    expect(calls).toHaveLength(1);
    await act(async () => calls[0].resolve({ success: true }));
    await f.settle();
    expect(f.submitted).toHaveLength(1);
    await f.unmount();
  });

  test("a declared failure still toasts its error and keeps the input", async () => {
    const f = mount();
    await f.render();
    await f.type("Great event");
    await f.click("Send feedback");
    await act(async () =>
      calls[0].resolve({
        success: false,
        error: "Too many submissions right now. Please try again shortly.",
      }),
    );
    await f.settle();

    expect(toasts).toEqual([
      {
        kind: "error",
        message: "Too many submissions right now. Please try again shortly.",
      },
    ]);
    expect(f.alert()).toBeNull();
    expect(f.textarea()?.value).toBe("Great event");
    expect(f.button("Send feedback")?.disabled).toBe(false);
    await f.unmount();
  });
});

describe("project feedback form labels and diagnostics", () => {
  test("the comment field is named like its visible label", async () => {
    const f = mount();
    await f.render();
    expect(f.textarea()?.getAttribute("aria-label")).toBe("Comment (optional)");
    await f.unmount();
  });

  test("the visibility copy names every reader and says it is private and named", async () => {
    const f = mount();
    await f.render();
    const text = f.textarea()?.parentNode?.textContent ?? "";
    expect(text).toContain(
      "Your feedback is private and never shown on the project page. You, the people who manage this project and Let's Assist administrators can read it. Your name is shown with your feedback.",
    );
    // The old copy claimed the organizer was the only reader.
    expect(text).not.toContain("Only the organizer");
    expect(text).not.toContain("—");
    await f.unmount();
  });

  test("the unknown-outcome log line is a registered static event", async () => {
    const { SAFE_LOG_MESSAGES } = await import("@/lib/log-event-catalog");
    expect(
      SAFE_LOG_MESSAGES.has("Project feedback submission did not return:"),
    ).toBe(true);
  });
});
