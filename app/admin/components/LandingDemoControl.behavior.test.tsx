import { beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";

let state: unknown[];
let cursor: number;
let inFlight: { current: boolean };
let pending: Promise<unknown>[];
let result: { error?: string; refreshPending?: true };
let rejectSave: boolean;
let rejectRead: boolean;
let deferredRead: Promise<{ enabled: boolean }> | null;
let refreshCalls: number;

mock.module("react", () => ({
  ...React,
  useId: () => "landing-mode",
  useState: (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in state)) state[slot] = initial;
    return [
      state[slot],
      (next: unknown) => {
        state[slot] = next;
      },
    ];
  },
  useRef: () => inFlight,
  useTransition: () => [
    false,
    (run: () => unknown) => {
      const promise = run();
      if (promise instanceof Promise) pending.push(promise);
    },
  ],
}));
mock.module("@/app/admin/server/landing-demo-mode", () => ({
  getLandingDemoModeForAdmin: async () => {
    refreshCalls++;
    if (rejectRead) throw new Error("private read context");
    return deferredRead ?? { enabled: true };
  },
  setLandingDemoMode: async () => {
    if (rejectSave) throw new Error("private transport context");
    return result;
  },
}));
const { LandingDemoControl } = await import("./LandingDemoControl");
type Node = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (React.isValidElement<Record<string, unknown>>(value))
    return text(value.props.children);
  return "";
}
function render(enabled: boolean | null = false, readVersion = "initial") {
  cursor = 0;
  return LandingDemoControl({ enabled, readVersion });
}
async function save() {
  const control = nodes(render()).find(
    (node) => typeof node.props.onCheckedChange === "function",
  );
  expect(control).toBeDefined();
  (control!.props.onCheckedChange as (value: boolean) => void)(true);
  await Promise.all(pending);
  return render();
}
beforeEach(() => {
  state = [];
  cursor = 0;
  inFlight = { current: false };
  pending = [];
  result = {};
  rejectSave = false;
  rejectRead = false;
  deferredRead = null;
  refreshCalls = 0;
});

test("a saved mode with any refresh pending is reported accurately without claiming public delay", async () => {
  result = { refreshPending: true };
  const output = await save();
  expect(text(output)).toContain(
    "Saved. Some page refreshes could not complete.",
  );
  expect(text(output)).not.toContain("was not saved");
  expect(refreshCalls).toBe(1);
  expect(text(output)).not.toContain("Landing pages may take longer");
});
test("an asynchronous read rejection after a confirmed save shows an unknown disabled mode", async () => {
  rejectRead = true;
  const output = await save();
  expect(text(output)).toContain("Saved. This view could not refresh.");
  expect(text(output)).toContain("Mode unavailable");
  expect(text(output)).not.toContain("was not saved");
  expect(text(output)).not.toContain("Real content");
  const control = nodes(output).find(
    (node) => typeof node.props.onCheckedChange === "function",
  );
  expect(control?.props.disabled).toBe(true);
  expect(text(output)).not.toContain("private");
});
test("a rejected write remains a save failure and never requests refresh", async () => {
  for (const rejection of [false, true]) {
    rejectSave = rejection;
    result = { error: "private backend context" };
    expect(text(await save())).toContain("was not saved");
    expect(refreshCalls).toBe(0);
  }
});
test("retry retains the unknown state until an awaited fresh read resolves", async () => {
  rejectRead = true;
  await save();
  rejectRead = false;
  let finishRead!: (value: { enabled: boolean }) => void;
  deferredRead = new Promise((resolve) => {
    finishRead = resolve;
  });
  const output = render();
  const reload = nodes(output).find((node) => node.props.children === "Reload");
  expect(reload).toBeDefined();
  (reload!.props.onClick as () => void)();
  const waiting = render();
  expect(text(waiting)).toContain("Saved. This view could not refresh.");
  expect(text(waiting)).toContain("Mode unavailable");
  expect(
    nodes(waiting).find(
      (node) => typeof node.props.onCheckedChange === "function",
    )?.props.disabled,
  ).toBe(true);
  finishRead({ enabled: true });
  await Promise.all(pending);
  const settled = render();
  expect(text(settled)).not.toContain("could not refresh");
  expect(text(settled)).toContain("Sample content. Fictional");
  expect(
    nodes(settled).find(
      (node) => typeof node.props.onCheckedChange === "function",
    )?.props.checked,
  ).toBe(true);
  expect(
    nodes(settled).find(
      (node) => typeof node.props.onCheckedChange === "function",
    )?.props.disabled,
  ).toBe(false);
});

test("a fresh repeated false snapshot replaces a locally confirmed true mode", async () => {
  await save();
  expect(text(render())).toContain("Sample content. Fictional");
  render(false, "authoritative-revert");
  const output = render(false, "authoritative-revert");
  expect(text(output)).toContain("Real content");
  expect(
    nodes(output).find(
      (node) => typeof node.props.onCheckedChange === "function",
    )?.props.checked,
  ).toBe(false);
});

test("an RSC snapshot adopts its mode without discarding a saved refresh warning", async () => {
  result = { refreshPending: true };
  await save();
  render(true, "server-action-refresh");
  const output = render(true, "server-action-refresh");
  expect(text(output)).toContain(
    "Saved. Some page refreshes could not complete.",
  );
  expect(text(output)).toContain("Sample content. Fictional");
});
