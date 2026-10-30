/**
 * The real AnonymousLinkingDialog on the minimal test DOM, with mocked
 * server actions and Supabase auth: no real account, signup, email or link.
 *
 * Base UI Dialog and Tabs need browser APIs the minimal DOM does not have,
 * so they are replaced by plain stand-ins that render children when open
 * and every tab panel. The dialog's own handlers, forms, buttons, guards and
 * disclosure are the real components.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";

import {
  fireEvent,
  installMinimalDom,
  type MinimalElement,
  type MinimalFormElement,
} from "@/tests/support/minimal-dom";

const { document } = installMinimalDom();

type Pending<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };
const currentCalls: Array<Pending<{ error?: string }>> = [];
const newAccountCalls: Array<{
  email: string;
  pending: Pending<{ error?: string; requiresEmailVerification?: boolean }>;
}> = [];
const routerCalls: string[] = [];
const toasts: Array<[string, string]> = [];
let signedInEmail: string | null = null;

mock.module("./actions", () => ({
  linkAnonymousToAuthenticatedAccount: () =>
    new Promise((resolve, reject) => currentCalls.push({ resolve, reject })),
  linkAnonymousToExistingAccount: async () => ({ error: "not used" }),
  linkAnonymousToNewAccount: (_id: string, _token: string, email: string) =>
    new Promise((resolve, reject) =>
      newAccountCalls.push({ email, pending: { resolve, reject } }),
    ),
  startAnonymousGoogleLink: async () => ({ error: "not used" }),
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: signedInEmail ? { id: "user-1", email: signedInEmail } : null,
        },
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  }),
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => void routerCalls.push(`replace:${href}`),
    refresh: () => void routerCalls.push("refresh"),
  }),
}));
mock.module("next/image", () => ({ default: () => <span /> }));
mock.module("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
mock.module("sonner", () => ({
  toast: {
    success: (m: string) => void toasts.push(["success", m]),
    error: (m: string) => void toasts.push(["error", m]),
  },
}));
mock.module("@/components/icons/animated", () => ({
  LinkIcon: () => null,
  useAnimatedIcon: () => ({ ref: null, triggerProps: {} }),
}));
const passthrough = ({ children }: { children?: ReactNode }) => (
  <div>{children}</div>
);
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-dialog>{children}</div> : null,
  DialogContent: passthrough,
  DialogHeader: passthrough,
  DialogFooter: passthrough,
  DialogTitle: passthrough,
  DialogDescription: passthrough,
}));
mock.module("@/components/ui/tabs", () => ({
  Tabs: passthrough,
  TabsList: passthrough,
  TabsTrigger: passthrough,
  TabsContent: passthrough,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AnonymousLinkingDialog } = await import("./AnonymousLinkingDialog");

const ID = "00000000-0000-4000-8000-0000000000a1";
const TOKEN = "fictional-token";

beforeEach(() => {
  currentCalls.length = 0;
  newAccountCalls.length = 0;
  routerCalls.length = 0;
  toasts.length = 0;
});

async function mount() {
  const linked: string[] = [];
  const accountCreated: string[] = [];
  const legacyPending: string[] = [];
  const container = document.createElement("div");
  const root = createRoot(container as unknown as Element);
  const tree = container as unknown as MinimalElement;
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  await act(() =>
    root.render(
      <AnonymousLinkingDialog
        anonymousId={ID}
        anonymousToken={TOKEN}
        defaultName="Fictional Guest"
        defaultEmail="guest@example.test"
        isLinked={false}
        onLinked={() => void linked.push("linked")}
        onLinkedPendingVerification={(e) => void legacyPending.push(e)}
        onAccountCreatedPendingVerification={(e) => void accountCreated.push(e)}
      />,
    ),
  );
  await settle();
  const find = (p: (e: MinimalElement) => boolean) => tree.find(p);
  const button = (text: string) =>
    find(
      (e) => e.tagName === "BUTTON" && e.textContent.trim().endsWith(text),
    ) as MinimalFormElement | null;
  const click = async (text: string) => {
    await act(() => {
      const node = button(text);
      if (!node) throw new Error(`No button ${text}`);
      fireEvent(node, "click");
    });
    await settle();
  };
  return {
    tree,
    find,
    button,
    click,
    settle,
    linked,
    accountCreated,
    legacyPending,
    unmount: () => act(() => root.unmount()),
  };
}

describe("anonymous linking dialog", () => {
  test("signed out: every method is shown directly, with no disclosure", async () => {
    signedInEmail = null;
    const d = await mount();
    await d.click("Link or create account");
    expect(d.find((e) => e.tagName === "DETAILS")).toBeNull();
    expect(d.button("Link to this account")).toBeNull();
    expect(d.tree.textContent).toContain("Existing account");
    expect(d.tree.textContent).toContain("Create account");
    expect(d.button("Continue with Google")).not.toBeNull();
    await d.unmount();
  });

  test("signed in: link to this account is primary; others sit in a closed disclosure", async () => {
    signedInEmail = "me@example.test";
    const d = await mount();
    await d.click("Link or create account");
    const primary = d.button("Link to this account");
    expect(primary).not.toBeNull();
    expect(primary?.getAttribute("class")).toContain("bg-primary");
    const details = d.find((e) => e.tagName === "DETAILS");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    const summary = details?.find((e) => e.tagName === "SUMMARY");
    expect(summary?.textContent).toBe("Use a different account");
    // The alternatives stay reachable inside it.
    expect(details?.textContent).toContain("Existing account");
    expect(details?.textContent).toContain("Continue with Google");
    await d.unmount();
  });

  test("a double click sends one link; success finishes once", async () => {
    signedInEmail = "me@example.test";
    const d = await mount();
    await d.click("Link or create account");
    await act(() => {
      const node = d.button("Link to this account");
      if (!node) throw new Error("no primary");
      fireEvent(node, "click");
      fireEvent(node, "click");
    });
    expect(currentCalls).toHaveLength(1);
    await act(async () => currentCalls[0].resolve({}));
    await d.settle();
    expect(d.linked).toEqual(["linked"]);
    expect(routerCalls).toContain("replace:/dashboard");
    await d.unmount();
  });

  test("a declared error keeps the dialog usable for another try", async () => {
    signedInEmail = "me@example.test";
    const d = await mount();
    await d.click("Link or create account");
    await d.click("Link to this account");
    await act(async () =>
      currentCalls[0].resolve({ error: "Already linked to another account." }),
    );
    await d.settle();
    expect(toasts).toContainEqual([
      "error",
      "Already linked to another account.",
    ]);
    expect(d.linked).toEqual([]);
    await d.click("Link to this account");
    expect(currentCalls).toHaveLength(2);
    await d.unmount();
  });

  test("a new account without a session is created, not linked, and the verification step shows", async () => {
    signedInEmail = null;
    const d = await mount();
    await d.click("Link or create account");
    const forms = [] as MinimalElement[];
    const collect = (node: MinimalElement) => {
      for (const child of node.children) {
        if (child.tagName === "FORM") forms.push(child);
        collect(child);
      }
    };
    collect(d.tree);
    const createForm = forms[1];
    // React may set `type` as a property, which the shim does not reflect.
    const password = createForm.find(
      (e) =>
        e.tagName === "INPUT" &&
        (e.getAttribute("type") === "password" ||
          (e as MinimalFormElement).type === "password"),
    ) as MinimalFormElement;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(password),
        "value",
      )?.set?.call(password, "fictional-pass-123");
      fireEvent(password, "input");
    });
    await act(() => void fireEvent(createForm, "submit"));
    await d.settle();
    expect(newAccountCalls.map((c) => c.email)).toEqual(["guest@example.test"]);
    await act(async () =>
      newAccountCalls[0].pending.resolve({ requiresEmailVerification: true }),
    );
    await d.settle();

    expect(d.accountCreated).toEqual(["guest@example.test"]);
    expect(d.linked).toEqual([]);
    expect(d.legacyPending).toEqual([]);
    expect(routerCalls).toEqual([]);
    expect(d.tree.textContent).toContain(
      "Check your email to finish account access",
    );
    await d.unmount();
  });
});
