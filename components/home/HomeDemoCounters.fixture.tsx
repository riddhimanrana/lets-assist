import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as React from "react";
import { HOME_DEMO_MAX_TICK } from "./home-demo-data";

const scenario = process.argv[2];
let effect: (() => (() => void) | void) | undefined;
let tick = 0;
mock.module("react", () => ({
  ...React,
  useState: () => [
    0,
    (value: number) => {
      tick = value;
    },
  ],
  useEffect: (fn: typeof effect) => {
    effect = fn;
  },
}));
let hidden = false;
let reducedMotion = scenario === "reduced";
const listeners = new Map<string, () => void>();
const active = new Map<number, () => void>();
let sequence = 0;
const media = {
  get matches() {
    return reducedMotion;
  },
  addEventListener: (name: string, fn: () => void) =>
    listeners.set(`media-${name}`, fn),
  removeEventListener: (name: string) => listeners.delete(`media-${name}`),
};
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    matchMedia: () => media,
    setInterval: (fn: () => void) => {
      active.set(++sequence, fn);
      return sequence;
    },
    clearInterval: (id: number) => {
      active.delete(id);
    },
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    get hidden() {
      return hidden;
    },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  },
});
const { HomeDemoExperience } = await import("./HomeDemoExperience");
function findCounters(node: unknown): (() => unknown) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCounters(child);
      if (found) return found;
    }
  } else if (React.isValidElement<{ children?: unknown }>(node)) {
    if (
      typeof node.type === "function" &&
      node.type.name === "HomeDemoCounters"
    )
      return node.type as () => unknown;
    return findCounters(node.props.children);
  }
}
const counters = findCounters(HomeDemoExperience({ showGreeting: false }));
assert.ok(counters);
counters();
const cleanup = effect?.();
assert.equal(active.size, reducedMotion ? 0 : 1);
if (scenario === "reduced") {
  assert.equal(tick, 0);
  reducedMotion = false;
  listeners.get("media-change")?.();
  assert.equal(active.size, 1);
  active.values().next().value?.();
  assert.equal(tick, 1);
  reducedMotion = true;
  listeners.get("media-change")?.();
  assert.equal(active.size, 0);
} else if (scenario === "hidden") {
  active.values().next().value?.();
  assert.equal(tick, 1);
  hidden = true;
  listeners.get("visibilitychange")?.();
  assert.equal(active.size, 0);
  hidden = false;
  listeners.get("visibilitychange")?.();
  assert.equal(active.size, 1);
  active.values().next().value?.();
  assert.equal(tick, 2);
} else if (scenario === "cap") {
  for (let i = 0; i < HOME_DEMO_MAX_TICK; i++) active.values().next().value?.();
  assert.equal(tick, HOME_DEMO_MAX_TICK);
  assert.equal(active.size, 0);
  listeners.get("visibilitychange")?.();
  assert.equal(active.size, 0);
}
cleanup?.();
assert.equal(active.size, 0);
assert.equal(listeners.size, 0);
