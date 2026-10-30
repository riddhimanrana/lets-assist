/**
 * The real useDraftAutosave hook in a small React harness on the minimal test
 * DOM, with a controllable draft session and manual timers. Proves debounce,
 * status transitions and cleanup; not the ProjectCreator page or the server.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { useMemo } from "react";

import type { EventFormState } from "@/hooks/use-event-form";
import type { createProjectDraftSession } from "@/lib/projects/draft-session";
import {
  installMinimalDom,
  type MinimalElement,
} from "@/tests/support/minimal-dom";

const { document } = installMinimalDom();
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useDraftAutosave } = await import("./use-draft-autosave");

// React captured its own timers at import. Only the hook's timers go through
// this manual scheduler.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const timers = new Map<number, { callback: () => void; ms: number }>();
let nextTimer = 0;
globalThis.setTimeout = ((callback: () => void, ms = 0) => {
  timers.set(++nextTimer, { callback, ms });
  return nextTimer;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((handle: number) =>
  void timers.delete(handle)) as unknown as typeof clearTimeout;
afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

/** Runs every due timer once, then lets async callbacks settle. */
async function fireTimers() {
  await act(async () => {
    const due = [...timers.entries()];
    for (const [handle] of due) timers.delete(handle);
    for (const [, timer] of due) timer.callback();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

type SaveResult = { autosaved?: boolean; id?: string; error?: string };
let saveCalls = 0;
let nextSave: () => Promise<SaveResult> = async () => ({});
const session = {
  id: "draft-1",
  save: () => {
    saveCalls += 1;
    return nextSave();
  },
} as unknown as ReturnType<typeof createProjectDraftSession>;
const draftUrls: Array<string | undefined> = [];
const updateDraftUrl = (id?: string) => void draftUrls.push(id);
const getDraftSafeState = () => ({});

function Harness({
  snapshot,
  waiverRequired = false,
  isSubmitting = false,
}: {
  snapshot: string;
  waiverRequired?: boolean;
  isSubmitting?: boolean;
}) {
  const state = useMemo(
    () =>
      ({
        basicInfo: { title: "Fictional park cleanup" },
        waiverRequired,
      }) as unknown as EventFormState,
    [waiverRequired],
  );
  const { autosaveStatus } = useDraftAutosave({
    draftSession: session,
    updateDraftUrl,
    state,
    stateSnapshot: snapshot,
    initialDraftId: null,
    isSubmitting,
    isSavingDraft: false,
    getDraftSafeState,
  });
  return <p data-status={autosaveStatus}>{autosaveStatus}</p>;
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  return {
    render: (props: Parameters<typeof Harness>[0]) =>
      act(() => root.render(<Harness {...props} />)),
    status: () =>
      (container as unknown as MinimalElement).find((e) => e.tagName === "P")
        ?.textContent,
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  timers.clear();
  saveCalls = 0;
  draftUrls.length = 0;
  nextSave = async () => ({});
});

describe("draft autosave status", () => {
  test("a failed save stays visible instead of fading back to Autosave on", async () => {
    const h = mount();
    nextSave = async () => ({ error: "Could not save draft." });
    await h.render({ snapshot: "a" });
    expect([...timers.values()].map((t) => t.ms)).toEqual([3000]);

    await fireTimers();
    expect(saveCalls).toBe(1);
    expect(h.status()).toBe("error");
    // No reset timer is left behind, so nothing can turn this into idle.
    expect(timers.size).toBe(0);
    await fireTimers();
    expect(h.status()).toBe("error");
    await h.unmount();
  });

  test("a thrown save also stays visible", async () => {
    const h = mount();
    nextSave = async () => {
      throw new Error("network");
    };
    await h.render({ snapshot: "a" });
    await fireTimers();
    expect(h.status()).toBe("error");
    expect(timers.size).toBe(0);
    await h.unmount();
  });

  test("the next attempt replaces the error, and a success still fades", async () => {
    const h = mount();
    nextSave = async () => ({ error: "Could not save draft." });
    await h.render({ snapshot: "a" });
    await fireTimers();
    expect(h.status()).toBe("error");

    // A later edit schedules a new attempt; the error stays until it runs.
    let finish: (result: SaveResult) => void = () => {};
    nextSave = () => new Promise((resolve) => (finish = resolve));
    await h.render({ snapshot: "b" });
    expect(h.status()).toBe("error");
    await fireTimers();
    expect(h.status()).toBe("saving");

    await act(async () => finish({ autosaved: true, id: "draft-1" }));
    expect(h.status()).toBe("saved");
    expect(draftUrls).toEqual(["draft-1"]);
    // The saved notice keeps its 3-second fade.
    expect([...timers.values()].map((t) => t.ms)).toEqual([3000]);
    await fireTimers();
    expect(h.status()).toBe("idle");
    await h.unmount();
  });

  test("rapid edits are debounced into one save", async () => {
    const h = mount();
    nextSave = async () => ({ autosaved: true, id: "draft-1" });
    await h.render({ snapshot: "a" });
    await h.render({ snapshot: "ab" });
    await h.render({ snapshot: "abc" });
    expect(timers.size).toBe(1);
    await fireTimers();
    expect(saveCalls).toBe(1);
    await h.unmount();
  });

  test("waiver projects and in-progress publishing never autosave", async () => {
    const h = mount();
    await h.render({ snapshot: "a", waiverRequired: true });
    expect(timers.size).toBe(0);
    await h.render({ snapshot: "b", isSubmitting: true });
    expect(timers.size).toBe(0);
    expect(saveCalls).toBe(0);
    await h.unmount();
  });

  test("unmounting before the debounce ends cancels the save", async () => {
    const h = mount();
    await h.render({ snapshot: "a" });
    expect(timers.size).toBe(1);
    await h.unmount();
    expect(timers.size).toBe(0);
    expect(saveCalls).toBe(0);
  });
});
