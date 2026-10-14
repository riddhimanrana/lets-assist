import { beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";

let state: unknown[];
let cursor: number;
let verifyCalls: Array<{ factorId: string; code: string }>;

mock.module("react", () => ({
  ...React,
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
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      mfa: {
        challengeAndVerify: async (input: {
          factorId: string;
          code: string;
        }) => {
          verifyCalls.push(input);
          return { error: null };
        },
      },
    },
  }),
}));
mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));
const { default: MfaChallengeClient } = await import("./MfaChallengeClient");
const { Button } = await import("@/components/ui/button");
const { InputOTP } = await import("@/components/ui/input-otp");
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
function render() {
  cursor = 0;
  return MfaChallengeClient({ redirectPath: "/home", email: null });
}
function submit(output: unknown) {
  const form = nodes(output).find((node) => node.type === "form");
  expect(form).toBeDefined();
  let prevented = false;
  (form!.props.onSubmit as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => {
      prevented = true;
    },
  });
  return prevented;
}
const factors = [
  {
    id: "fictional-factor-a",
    friendly_name: "Fictional phone",
    factor_type: "totp",
    status: "verified",
  },
  {
    id: "fictional-factor-b",
    friendly_name: "Fictional tablet",
    factor_type: "totp",
    status: "verified",
  },
];
beforeEach(() => {
  // State order in the component: isLoading, isVerifying, errorMessage,
  // verificationCode, factors, selectedFactorId.
  state = [false, false, null, "123456", factors, "fictional-factor-a"];
  cursor = 0;
  verifyCalls = [];
});

test("the challenge title is the one page heading", () => {
  const headings = nodes(render()).filter((node) => node.type === "h1");
  expect(headings).toHaveLength(1);
  expect(text(headings[0])).toBe("Verify it’s really you");
});

test("the code field is named by a label bound to the real input", () => {
  const output = nodes(render());
  const label = output.find((node) => node.type === "label");
  const input = output.find((node) => node.type === InputOTP);
  expect(text(label)).toBe("6-digit authenticator code");
  expect(typeof input?.props.id).toBe("string");
  expect(label?.props.htmlFor).toBe(input?.props.id);
});

test("Enter submits the form through the existing verification", async () => {
  const output = render();
  expect(submit(output)).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(verifyCalls).toEqual([
    { factorId: "fictional-factor-a", code: "123456" },
  ]);
});

test("only Verify submits, and it has no second click handler", () => {
  const buttons = nodes(render()).filter(
    (node) => node.type === Button || node.type === "button",
  );
  const submitters = buttons.filter((node) => node.props.type === "submit");
  expect(submitters).toHaveLength(1);
  expect(text(submitters[0])).toBe("Verify and continue");
  expect(submitters[0].props.onClick).toBeUndefined();
  expect(submitters[0].props.disabled).toBe(false);
  // Two factor choices and "Use another account".
  const others = buttons.filter((node) => node.props.type !== "submit");
  expect(others).toHaveLength(3);
  for (const button of others) expect(button.props.type).toBe("button");
});

test("a submit during verification does not start a second challenge", () => {
  state[1] = true;
  const output = render();
  const submitter = nodes(output).find((node) => node.props.type === "submit");
  expect(submitter?.props.disabled).toBe(true);
  expect(submit(output)).toBe(true);
  expect(verifyCalls).toEqual([]);
});

test("an incomplete code keeps Verify disabled", () => {
  state[3] = "123";
  const submitter = nodes(render()).find(
    (node) => node.props.type === "submit",
  );
  expect(submitter?.props.disabled).toBe(true);
});
