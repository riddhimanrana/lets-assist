import { beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";

let state: unknown[];
let cursor: number;
let logoutResult: { success: boolean; error?: string };
let rejectLogout: boolean;
let toastErrors: unknown[][];

const useState = (initial: unknown) => {
  const slot = cursor++;
  if (!(slot in state)) state[slot] = initial;
  return [
    state[slot],
    (next: unknown) => {
      state[slot] = next;
    },
  ];
};
mock.module("react", () => ({ ...React, useState }));
mock.module("next/navigation", () => ({ usePathname: () => "/home" }));
mock.module("@/app/logout/actions", () => ({
  logout: async () => {
    if (rejectLogout) throw new Error("private transport context");
    return logoutResult;
  },
}));
mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "fictional-user",
      email: "volunteer@example.test",
      user_metadata: {},
      identities: [],
    },
    loading: false,
  }),
}));
mock.module("@/hooks/useUserProfile", () => ({
  useUserProfile: () => ({ profile: null, loading: false }),
}));
mock.module("@/components/layout/navbar/useDevPreviewSource", () => ({
  useDevPreviewSource: () => ({
    source: "local",
    isLocalDevHost: false,
    selectSource: () => {},
  }),
}));
mock.module("@/components/notifications/NotificationPopover", () => ({
  NotificationPopover: () => null,
}));
mock.module("@/components/feedback/DonateDialog", () => ({
  DonateDialog: () => null,
}));
mock.module("@/components/feedback/FeedbackDialog", () => ({
  FeedbackDialog: () => null,
}));
mock.module("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => {
      toastErrors.push(args);
    },
  },
}));
const { default: Navbar } = await import("./Navbar");
const { AccountMenu } = await import("./navbar/AccountMenu");
type Node = React.ReactElement<Record<string, unknown>>;
type Account = { isLoggingOut: boolean; onLogout: () => Promise<void> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function account() {
  cursor = 0;
  const menu = nodes(Navbar()).find((node) => node.type === AccountMenu);
  expect(menu).toBeDefined();
  return menu!.props.account as Account;
}
const LOGOUT_FAILED = "We could not sign you out. Please try again.";
beforeEach(() => {
  state = [];
  cursor = 0;
  logoutResult = { success: false, error: "private provider context" };
  rejectLogout = false;
  toastErrors = [];
});

test("a refused logout tells the user and returns the control", async () => {
  await account().onLogout();
  expect(toastErrors).toEqual([[LOGOUT_FAILED]]);
  expect(account().isLoggingOut).toBe(false);
});

test("a thrown logout shows the same fixed message with no error detail", async () => {
  rejectLogout = true;
  await account().onLogout();
  expect(toastErrors).toEqual([[LOGOUT_FAILED]]);
  expect(JSON.stringify(toastErrors)).not.toContain("private");
  expect(account().isLoggingOut).toBe(false);
});

test("mobile navbar stays above scrolling page content without hiding on scroll direction changes", () => {
  cursor = 0;
  const header = nodes(Navbar()).find((node) => node.type === "header");
  const classes = String(header!.props.className).split(" ");
  expect(classes).toContain("sticky");
  expect(classes).toContain("top-0");
  expect(classes).toContain("z-40");
  expect(classes).toContain("lg:static");
  expect(classes).not.toContain("fixed");
  const brand = nodes(Navbar()).find((node) => node.props.href === "/");
  expect(brand!.props.className).toContain("min-h-11");
  const mobileControls = nodes(Navbar()).find((node) =>
    String(node.props.className).includes("[&>button]:size-11"),
  );
  expect(mobileControls).toBeDefined();
});
