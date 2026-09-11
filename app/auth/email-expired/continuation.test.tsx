import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
let resendArgs: unknown[] = [];
let verified: ((token: string) => Promise<void>) | undefined;
mock.module("@/app/signup/actions", () => ({
  resendVerificationEmail: async (...args: unknown[]) => {
    resendArgs = args;
    return { success: true };
  },
}));
mock.module("@/components/shared/BotVerificationDialog", () => ({
  BotVerificationDialog: ({ onVerified }: { onVerified: typeof verified }) => {
    verified = onVerified;
    return null;
  },
}));
mock.module("sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));
const { default: EmailExpiredClient } = await import("./EmailExpiredClient");
beforeEach(() => {
  resendArgs = [];
  verified = undefined;
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
  await verified!("fictional-captcha");
  expect(resendArgs).toEqual([
    "fictional@example.test",
    "fictional-captcha",
    null,
  ]);
});
