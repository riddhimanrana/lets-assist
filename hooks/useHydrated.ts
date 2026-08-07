"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Whether React is rendering on the client.
 *
 * This deliberately avoids the `useState` + `useEffect` pattern: if hydration
 * fails — for example a browser extension mutated the DOM before React
 * attached — the effect can be skipped and the flag never flips, leaving forms
 * disabled forever. `useSyncExternalStore` reads the client snapshot during any
 * client render, including the client-only re-render React performs after a
 * hydration mismatch, so the value flips as soon as React runs at all.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
