/**
 * LinkAccountSection on the minimal test DOM. The linking dialog is a stub
 * that counts mounts, so these tests prove the section's state routing, not
 * the dialog's own behavior (covered in AnonymousLinkingDialog.lifecycle).
 */
import { describe, expect, mock, test } from "bun:test";
import { useEffect, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  installMinimalDom,
  type MinimalElement,
} from "@/tests/support/minimal-dom";

const { document } = installMinimalDom();

const dialogMounts: string[] = [];
const dialogProps: Array<Record<string, unknown>> = [];
mock.module("../AnonymousLinkingDialog", () => ({
  AnonymousLinkingDialog: (props: Record<string, unknown>) => {
    dialogProps.push(props);
    useEffect(() => {
      dialogMounts.push("mount");
      return () => void dialogMounts.push("unmount");
    }, []);
    return <div data-testid="linking-dialog" />;
  },
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: Record<string, unknown>) => (
    <a href={href as string} {...rest}>
      {children as ReactNode}
    </a>
  ),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { LinkAccountSection, LINK_ACCOUNT_DESCRIPTION } =
  await import("./LinkAccountSection");

const ID = "00000000-0000-4000-8000-0000000000a1";
const TOKEN = "fictional-token";

type Props = Parameters<typeof LinkAccountSection>[0];
const base: Props = {
  id: ID,
  accessToken: TOKEN,
  name: "Fictional Guest",
  email: "guest@example.test",
  linkStatus: "unlinked",
  isLinked: false,
  autoLinkError: null,
  verificationPendingEmail: null,
  onLinked: () => {},
  onLinkedPendingVerification: () => {},
};
const render = (props: Partial<Props>) =>
  renderToStaticMarkup(<LinkAccountSection {...base} {...props} />);

describe("link account states", () => {
  test("the description is neutral and invents no approval state", () => {
    // React escapes the straight apostrophe in "Let's".
    const html = render({}).replaceAll("&#x27;", "'");
    expect(html).toContain(LINK_ACCOUNT_DESCRIPTION);
    expect(LINK_ACCOUNT_DESCRIPTION).not.toContain("’");
    expect(html).not.toContain("pending approval");
  });

  test("unlinked: only the linking dialog", () => {
    const html = render({});
    expect(html).toContain('data-testid="linking-dialog"');
    expect(html).not.toContain("Verify your email to finish linking");
  });

  test("account created, not linked: a sign-in step back to this profile, dialog kept", () => {
    const html = render({ accountCreatedEmail: "new@example.test" });
    expect(html).toContain("Verify your email to finish linking");
    expect(html).toContain("new@example.test");
    expect(html).toContain("Your guest signups stay here, unchanged");
    expect(html).toContain('data-testid="linking-dialog"');
    const href = /href="([^"]+)"/u.exec(html)?.[1] ?? "";
    const redirect = decodeURIComponent(
      new URLSearchParams(href.replaceAll("&amp;", "&").split("?")[1]).get(
        "redirect",
      ) ?? "",
    );
    expect(redirect).toBe(`/anonymous/${ID}?token=${TOKEN}&link=1`);
    // Not the linked-but-unverified notice.
    expect(html).not.toContain("Your volunteer profile is linked");
  });

  test("legacy linked but unverified keeps its own notice", () => {
    const html = render({
      linkStatus: "verification-pending",
      isLinked: true,
      verificationPendingEmail: "old@example.test",
    });
    expect(html).toContain("Your volunteer profile is linked");
    expect(html).toContain("old@example.test");
    expect(html).not.toContain('data-testid="linking-dialog"');
  });

  test("linked", () => {
    const html = render({ linkStatus: "linked", isLinked: true });
    expect(html).toContain("Account linked successfully");
    expect(html).not.toContain('data-testid="linking-dialog"');
  });

  test("the dialog receives the account-created callback and isLinked false", () => {
    dialogProps.length = 0;
    const onAccountCreated = () => {};
    render({ onAccountCreatedPendingVerification: onAccountCreated });
    expect(dialogProps.at(-1)?.onAccountCreatedPendingVerification).toBe(
      onAccountCreated,
    );
    expect(dialogProps.at(-1)?.isLinked).toBe(false);
  });
});

describe("link account section lifecycle", () => {
  test("showing the account-created notice does not remount the dialog", async () => {
    dialogMounts.length = 0;
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(() => root.render(<LinkAccountSection {...base} />));
    await act(() =>
      root.render(
        <LinkAccountSection {...base} accountCreatedEmail="new@example.test" />,
      ),
    );
    // The verification dialog lives inside the linking dialog, so it must
    // survive the parent's state change.
    expect(dialogMounts).toEqual(["mount"]);
    const text = (container as unknown as MinimalElement).textContent;
    expect(text).toContain("Verify your email to finish linking");

    // A later real link replaces the dialog, as before.
    await act(() =>
      root.render(
        <LinkAccountSection {...base} linkStatus="linked" isLinked />,
      ),
    );
    expect(dialogMounts).toEqual(["mount", "unmount"]);
    await act(() => root.unmount());
  });
});
