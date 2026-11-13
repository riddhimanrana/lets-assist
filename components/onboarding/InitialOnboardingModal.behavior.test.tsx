import { expect, mock, test } from "bun:test";
import * as React from "react";
import * as HookForm from "react-hook-form";
let stateIndex = 0;
mock.module("react", () => ({
  ...React,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = stateIndex++;
    // Simulate the username blur request running after the modal has mounted.
    return [index === 2 || index === 6 ? true : initial, () => {}];
  },
}));
const submissions: unknown[][] = [];
mock.module("./onboarding-actions", () => ({
  completeInitialOnboarding: async (...values: unknown[]) => {
    submissions.push(values);
    return { error: "Fictional validation response" };
  },
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ replace: () => {} }),
  usePathname: () => "/home",
}));
mock.module("sonner", () => ({
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));
mock.module("react-hook-form", () => ({
  ...HookForm,
  Controller: () => null,
  useForm: () => ({
    watch: (name: string) => (name === "username" ? "alex" : ""),
    handleSubmit: (submit: (values: unknown) => unknown) => () =>
      submit({ username: "alex", phoneNumber: "" }),
    control: {},
  }),
}));
const { default: InitialOnboardingModal } =
  await import("./InitialOnboardingModal");
test("a pending blur check does not swallow the first Get started submission", async () => {
  stateIndex = 0;
  const tree = InitialOnboardingModal({
    isOpen: true,
    onClose: () => {},
    userId: "fictional",
  });
  const nodes: Array<{ type: unknown; props: Record<string, unknown> }> = [];
  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const node = value as (typeof nodes)[number];
    nodes.push(node);
    walk(node.props.children);
  }
  walk(tree);
  const button = nodes.find((n) => n.props.type === "submit");
  expect(button?.props.disabled).toBe(false);
  const form = nodes.find((n) => n.type === "form");
  await (form?.props.onSubmit as () => Promise<void>)();
  expect(submissions).toEqual([["alex", ""]]);
});
