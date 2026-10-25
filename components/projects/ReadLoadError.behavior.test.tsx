import { beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";

let pending = false;
let refreshes = 0;
let transitions = 0;
mock.module("react", () => ({
  ...React,
  useTransition: () => [
    pending,
    (action: () => void) => {
      transitions += 1;
      action();
    },
  ],
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      refreshes += 1;
    },
  }),
}));
const { ReadLoadError } = await import("./ReadLoadError");

type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...elements(value.props.children)];
}
function content(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(content).join(" ");
  if (React.isValidElement<Record<string, unknown>>(value))
    return content(value.props.children);
  return "";
}
beforeEach(() => {
  pending = false;
  refreshes = 0;
  transitions = 0;
});

test("the actual retry handler refreshes once only after explicit activation", () => {
  const tree = ReadLoadError({ title: "Could not load fictional records" });
  const button = elements(tree).find(
    (element) => typeof element.props.onClick === "function",
  );
  expect(button).toBeDefined();
  expect(refreshes).toBe(0);
  expect(transitions).toBe(0);
  expect(button!.props.type).toBe("button");
  expect(button!.props.disabled).toBe(false);
  expect(content(button)).toBe("Try again");
  (button!.props.onClick as () => void)();
  expect(transitions).toBe(1);
  expect(refreshes).toBe(1);
});

test("a pending route refresh disables the control and announces loading without retrying", () => {
  pending = true;
  const tree = ReadLoadError({ title: "Could not load fictional records" });
  const button = elements(tree).find(
    (element) => typeof element.props.onClick === "function",
  );
  expect(tree.props["aria-busy"]).toBe(true);
  expect(button!.props.disabled).toBe(true);
  expect(button!.props.focusableWhenDisabled).toBe(true);
  expect(content(button)).toBe("Trying again...");
  expect(refreshes).toBe(0);
  expect(transitions).toBe(0);
});
