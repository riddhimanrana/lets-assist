import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
let resendArgs: unknown[] = [];
let resendCalls = 0;
let resendGate: Promise<void> | undefined;
let resendResult: { success: boolean; error?: string } = { success: true };
let verified: ((token: string) => Promise<void>) | undefined;
let openChallenge: (() => void) | undefined;
let closeChallenge: (() => void) | undefined;
mock.module("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => {
    if (onClick) openChallenge = onClick;
    return <button>{children}</button>;
  },
}));
mock.module("@/app/signup/actions", () => ({
  resendVerificationEmail: async (...args: unknown[]) => {
    resendArgs = args;
    resendCalls += 1;
    await resendGate;
    return resendResult;
  },
}));
mock.module("@/components/shared/BotVerificationDialog", () => ({
  BotVerificationDialog: ({
    onVerified,
    onClose,
  }: {
    onVerified: typeof verified;
    onClose: () => void;
  }) => {
    verified = onVerified;
    closeChallenge = onClose;
    return null;
  },
}));
mock.module("sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));
const { default: EmailExpiredClient } = await import("./EmailExpiredClient");
beforeEach(() => {
  resendArgs = [];
  resendCalls = 0;
  resendGate = undefined;
  resendResult = { success: true };
  verified = undefined;
  openChallenge = undefined;
  closeChallenge = undefined;
});
test("expired verification retains the class path through resend and both auth alternatives", async () => {
  const path =
    "/organization/chapter/plugins/dvhs-csf/connect/ABC234?from=invite";
  const html = renderToStaticMarkup(
    <EmailExpiredClient
      email="fictional@example.test"
      redirectAfterAuth={path}
    />,
  );
  expect(html).toContain(`/login?redirect=${encodeURIComponent(path)}`);
  expect(html).toContain(`/signup?redirect=${encodeURIComponent(path)}`);
  openChallenge!();
  await verified!("fictional-captcha");
  expect(resendArgs).toEqual([
    "fictional@example.test",
    "fictional-captcha",
    path,
  ]);
});
test("unsafe continuations are stripped before resending or linking", async () => {
  const html = renderToStaticMarkup(
    <EmailExpiredClient
      email="fictional@example.test"
      redirectAfterAuth="//other.test/steal"
    />,
  );
  expect(html).not.toContain("other.test");
  openChallenge!();
  await verified!("fictional-captcha");
  expect(resendArgs).toEqual([
    "fictional@example.test",
    "fictional-captcha",
    null,
  ]);
});

test("a missing email offers class-preserving auth links without an unusable resend challenge", () => {
  const path = "/organization/chapter/plugins/dvhs-csf/connect/ABC234";
  const html = renderToStaticMarkup(
    <EmailExpiredClient email="" redirectAfterAuth={path} />,
  );
  expect(html).toContain(`/login?redirect=${encodeURIComponent(path)}`);
  expect(html).toContain(`/signup?redirect=${encodeURIComponent(path)}`);
  expect(html).toContain("Sign in with the account you used to join.");
  expect(html).not.toContain("Resend Verification Email");
  expect(verified).toBeUndefined();
  expect(resendArgs).toEqual([]);
});

test("duplicate challenge callbacks cannot resend while pending or after success", async () => {
  let release!: () => void;
  resendGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  renderToStaticMarkup(
    <EmailExpiredClient
      email="fictional@example.test"
      redirectAfterAuth="/organization/chapter/plugins/dvhs-csf/connect/ABC234"
    />,
  );
  const callback = verified!;
  openChallenge!();
  const pending = callback("first-challenge");
  await callback("duplicate-challenge");
  expect(resendCalls).toBe(1);
  release();
  await pending;
  await callback("late-challenge");
  expect(resendCalls).toBe(1);
});

test("an unsuccessful resend leaves an intentional retry available", async () => {
  resendResult = { success: false, error: "Temporary local test failure" };
  renderToStaticMarkup(
    <EmailExpiredClient
      email="fictional@example.test"
      redirectAfterAuth="/organization/chapter/plugins/dvhs-csf/connect/ABC234"
    />,
  );
  const callback = verified!;
  openChallenge!();
  await callback("first-challenge");
  expect(resendCalls).toBe(1);
  await callback("callback-after-failure");
  expect(resendCalls).toBe(1);
  resendResult = { success: true };
  openChallenge!();
  await callback("retry-challenge");
  expect(resendCalls).toBe(2);
});

test("canceling a challenge prevents its late verification callback from resending", async () => {
  renderToStaticMarkup(<EmailExpiredClient email="fictional@example.test" />);
  openChallenge!();
  closeChallenge!();
  await verified!("late-canceled-challenge");
  expect(resendCalls).toBe(0);
});
