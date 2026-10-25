import { afterAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type ActionResult = {
  success?: boolean;
  error?: string;
  deliveryUnconfirmed?: boolean;
  notice?: string;
  retryAfterSeconds?: number;
};
const sendVerificationEmail = mock(
  async (_email: string): Promise<ActionResult> => ({ success: true }),
);
mock.module("@/app/account/email-actions", () => ({
  sendVerificationEmail,
  verifyEmailToken: async () => ({ success: true }),
  setPrimaryEmailAction: async () => ({ success: true }),
  getLinkedIdentitiesAction: async () => ({ success: true, emails: [] }),
}));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { addEmail } = await import("@/utils/auth/account-management");
const { resolveAddEmailOutcome, UNCONFIRMED_DELIVERY_NOTICE } =
  await import("./email-add-outcome");

afterAll(() => mock.restore());

/** The same two calls the section makes when the form is submitted. */
async function submit(result: ActionResult) {
  sendVerificationEmail.mockImplementationOnce(async () => result);
  return resolveAddEmailOutcome(await addEmail("synthetic@example.test"));
}

describe("add email outcome", () => {
  test("a sent code moves to code entry", async () => {
    expect(await submit({ success: true })).toEqual({
      step: "code_entry",
      delivery: "sent",
    });
  });

  test("a definite failure raises an error and never reaches code entry", async () => {
    await expect(
      submit({ error: "Unable to send a verification code." }),
    ).rejects.toThrow("Unable to send a verification code.");
    expect(
      resolveAddEmailOutcome({ error: "Unable to send a verification code." }),
    ).toEqual({
      step: "error",
      tone: "error",
      message: "Unable to send a verification code.",
    });
  });

  test("an ambiguous delivery still moves to code entry, with the honest notice", async () => {
    const outcome = await submit({
      deliveryUnconfirmed: true,
      notice: UNCONFIRMED_DELIVERY_NOTICE,
      retryAfterSeconds: 60,
    });
    expect(outcome).toEqual({
      step: "code_entry",
      delivery: "unconfirmed",
      notice:
        "We could not confirm the email was sent. If a code arrives, enter it here, or send a new one.",
    });
  });

  test("a cooldown is an error, so a rate limit cannot open code entry", async () => {
    await expect(
      submit({
        error: "Please wait before requesting another verification code.",
        retryAfterSeconds: 30,
      }),
    ).rejects.toThrow("Please wait");
  });

  test("the section opens code entry only from a code_entry outcome", () => {
    const source = readFileSync(
      join(import.meta.dir, "EmailAddressesSection.tsx"),
      "utf8",
    );
    const request = source.slice(
      source.indexOf("const requestCode = async"),
      source.indexOf("const handleAddEmail = async"),
    );
    expect(request).toContain("resolveAddEmailOutcome(await addEmail(email))");
    expect(request.match(/setVerificationStep\(true\)/gu)).toHaveLength(1);
    expect(request.indexOf('outcome.step === "error"')).toBeLessThan(
      request.indexOf("setVerificationStep(true)"),
    );
    expect(source.match(/setVerificationStep\(true\)/gu)).toHaveLength(1);
    expect(source).toContain("Send a new code");
  });
});
