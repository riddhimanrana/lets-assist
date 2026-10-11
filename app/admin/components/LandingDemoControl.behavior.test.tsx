import { beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";

let state: unknown[];
let cursor: number;
let inFlight: { current: boolean };
let pending: Promise<unknown>[];
let result: { error?: string; refreshPending?: true };
let rejectSave: boolean;
let rejectRefresh: boolean;
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
mock.module("next/navigation", () => ({
  useRouter: () => ({
    refresh() {
      refreshCalls++;
      if (rejectRefresh) throw new Error("private router context");
    },
  }),
}));
mock.module("@/app/admin/server/landing-demo-mode", () => ({
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
function render(enabled: boolean | null = false) {
  cursor = 0;
  return LandingDemoControl({ enabled });
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
  rejectRefresh = false;
  refreshCalls = 0;
});

test("a saved mode with cache refresh pending is reported as saved", async () => {
  result = { refreshPending: true };
  const output = await save();
  expect(text(output)).toContain(
    "Saved. Landing pages may take longer to update.",
  );
  expect(text(output)).not.toContain("was not saved");
  expect(refreshCalls).toBe(1);
});
test("a router refresh failure after a confirmed save shows an unknown disabled mode", async () => {
  rejectRefresh = true;
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
test("a fresh server mode replaces the unknown post-save view", async () => {
  rejectRefresh = true;
  await save();
  const output = render(true);
  expect(text(output)).toContain("Demo preview");
  const settled = render(true);
  expect(text(settled)).not.toContain("could not refresh");
  expect(
    nodes(settled).find(
      (node) => typeof node.props.onCheckedChange === "function",
    )?.props.disabled,
  ).toBe(false);
});
