import assert from "node:assert/strict";
import { mock } from "bun:test";
import { hasReducedMotionListener, prefersReducedMotion } from "motion-dom";
import * as React from "react";

// The runtime behind landing-motion-lifecycle.fixture.tsx: a small hook
// runtime, a manual clock, stand-ins for `document` and `matchMedia`, and
// readers for the element tree a component returns. Importing this module
// puts the hook runtime behind `react` for the whole process, so it has to
// load before the components do and it imports none of them.

type Cleanup = () => void;
type Root = {
  render: () => unknown;
  output: unknown;
  slots: unknown[];
  effects: Map<number, { deps?: readonly unknown[]; cleanup?: Cleanup }>;
  queued: Array<() => void>;
  cursor: number;
  dirty: boolean;
  mounted: boolean;
};

const roots = new Set<Root>();
let rendering: Root | undefined;

function owner() {
  assert.ok(rendering, "A hook ran outside a render.");
  return rendering;
}

function useState<T>(initial: T | (() => T)) {
  const root = owner();
  const index = root.cursor++;
  if (!(index in root.slots)) {
    root.slots[index] =
      typeof initial === "function" ? (initial as () => T)() : initial;
  }
  const set = (next: T | ((previous: T) => T)) => {
    const previous = root.slots[index] as T;
    const value =
      typeof next === "function"
        ? (next as (previous: T) => T)(previous)
        : next;
    if (Object.is(value, previous)) return;
    root.slots[index] = value;
    root.dirty = true;
  };
  return [root.slots[index] as T, set] as const;
}

function useEffect(effect: () => void | Cleanup, deps?: readonly unknown[]) {
  const root = owner();
  const index = root.cursor++;
  const previous = root.effects.get(index);
  const unchanged =
    previous?.deps !== undefined &&
    deps !== undefined &&
    deps.length === previous.deps.length &&
    deps.every((value, at) => Object.is(value, previous.deps?.[at]));
  if (unchanged) return;
  root.queued.push(() => {
    previous?.cleanup?.();
    const cleanup = effect();
    root.effects.set(index, {
      deps,
      cleanup: typeof cleanup === "function" ? cleanup : undefined,
    });
  });
}

function useRef<T>(initial: T) {
  const root = owner();
  const index = root.cursor++;
  if (!(index in root.slots)) root.slots[index] = { current: initial };
  return root.slots[index] as { current: T };
}

function useMemo<T>(create: () => T) {
  return create();
}

// Renders until no effect or setter asks for another pass.
function flush(root: Root) {
  for (let pass = 0; pass < 25; pass++) {
    if (!root.mounted) return;
    root.cursor = 0;
    root.dirty = false;
    root.queued = [];
    rendering = root;
    try {
      root.output = root.render();
    } finally {
      rendering = undefined;
    }
    for (const run of root.queued) run();
    if (!root.dirty) return;
  }
  assert.fail("The component never settled.");
}

function settle() {
  for (const root of roots) if (root.dirty) flush(root);
}

export function mount<P>(component: (props: P) => unknown, initialProps: P) {
  let props = initialProps;
  const root: Root = {
    render: () => component(props),
    output: undefined,
    slots: [],
    effects: new Map(),
    queued: [],
    cursor: 0,
    dirty: false,
    mounted: true,
  };
  roots.add(root);
  flush(root);
  return {
    get output() {
      return root.output;
    },
    update(next: P) {
      props = next;
      flush(root);
    },
    replayEffects() {
      // Probe cleanup/setup with state retained, as in a development effect
      // replay. This remains a hook harness, not the real React reconciler.
      for (const { cleanup } of root.effects.values()) cleanup?.();
      root.effects.clear();
      flush(root);
    },
    unmount() {
      root.mounted = false;
      roots.delete(root);
      for (const { cleanup } of root.effects.values()) cleanup?.();
    },
  };
}

const hooks = { useState, useEffect, useRef, useMemo };
const react = { ...React, ...hooks };
mock.module("react", () => ({ ...react, default: react }));

// A manual clock behind the global timer functions the components call.
type Timer = { at: number; every: number | null; run: () => void };
export const timers = new Map<number, Timer>();
let now = 0;
let created = 0;

function schedule(run: () => void, delay: number, every: number | null) {
  timers.set(++created, { at: now + delay, every, run });
  return created;
}

export function advance(ms: number) {
  const until = now + ms;
  for (;;) {
    let due: [number, Timer] | undefined;
    for (const entry of timers) {
      if (entry[1].at <= until && (!due || entry[1].at < due[1].at)) {
        due = entry;
      }
    }
    if (!due) break;
    const [id, timer] = due;
    now = timer.at;
    if (timer.every === null) timers.delete(id);
    else timer.at += timer.every;
    timer.run();
    settle();
  }
  now = until;
}

// Every timer ever scheduled, including the ones already cleared.
export const timersCreated = () => created;
export const intervals = () =>
  [...timers.values()].filter((timer) => timer.every !== null);
export const timeouts = () =>
  [...timers.values()].filter((timer) => timer.every === null);

// The document and the reduced-motion media query.
const listeners = new Map<string, Set<() => void>>();
const listen = (key: string, run: () => void) => {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)?.add(run);
};
const unlisten = (key: string, run: () => void) => {
  listeners.get(key)?.delete(run);
  if (listeners.get(key)?.size === 0) listeners.delete(key);
};
const emit = (key: string) => {
  for (const run of [...(listeners.get(key) ?? [])]) run();
  settle();
};
export const listenerCount = () =>
  [...listeners.values()].reduce((total, set) => total + set.size, 0);

let hidden = false;
let reduced = false;
const media = {
  get matches() {
    return reduced;
  },
  addEventListener: (name: string, run: () => void) =>
    listen(`media:${name}`, run),
  removeEventListener: (name: string, run: () => void) =>
    unlisten(`media:${name}`, run),
};

// Called once the components have loaded, so that they load before any
// browser global exists.
export function installBrowserStandIns() {
  Object.assign(globalThis, {
    setInterval: (run: () => void, delay = 0) => schedule(run, delay, delay),
    setTimeout: (run: () => void, delay = 0) => schedule(run, delay, null),
    clearInterval: (id: number) => void timers.delete(id),
    clearTimeout: (id: number) => void timers.delete(id),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => media },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get hidden() {
        return hidden;
      },
      addEventListener: (name: string, run: () => void) =>
        listen(`document:${name}`, run),
      removeEventListener: (name: string, run: () => void) =>
        unlisten(`document:${name}`, run),
    },
  });
  // The motion library reads the preference once, when a component mounts.
  // The media query is what a later change arrives through.
  hasReducedMotionListener.current = true;
}

export function preferReducedMotion(value: boolean, announce = true) {
  reduced = value;
  prefersReducedMotion.current = value;
  if (announce) emit("media:change");
}

export function showDocument(visible: boolean, announce = true) {
  hidden = !visible;
  if (announce) emit("document:visibilitychange");
}

// Reading the returned element tree.
type Props = Record<string, unknown> & { children?: unknown };
type TreeElement = React.ReactElement<Props>;

export function elementsIn(node: unknown): TreeElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsIn);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elementsIn(node.props.children)];
}

export function textIn(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textIn).join("");
  if (React.isValidElement<Props>(node)) return textIn(node.props.children);
  return "";
}
