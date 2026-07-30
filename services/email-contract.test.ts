import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

type MockResendResponse = {
  data: { id: string } | null;
  error: { name: string; message: string } | null;
};

const resendSend = mock(
  async (
    _payload: unknown,
    _options?: unknown,
  ): Promise<MockResendResponse> => ({
    data: { id: "provider-message-id" },
    error: null,
  }),
);
const resendApiKeys: string[] = [];

class MockResend {
  readonly emails = { send: resendSend };

  constructor(apiKey: string) {
    resendApiKeys.push(apiKey);
  }
}

const createClient = mock(async () => {
  throw new Error("notification settings should not be queried in transactional tests");
});
const render = mock(async () => "<p>rendered React email</p>");
const logError = mock(() => undefined);
const logInfo = mock(() => undefined);
const logWarn = mock(() => undefined);
const sendMail = mock(async () => ({ messageId: "<mailpit-message-id>" }));
const createTransport = mock(() => ({ sendMail }));

mock.module("resend", () => ({ Resend: MockResend }));
mock.module("@/lib/supabase/server", () => ({ createClient }));
mock.module("@react-email/components", () => ({ render }));
mock.module("@/lib/logger", () => ({ logError, logInfo, logWarn }));
mock.module("nodemailer", () => ({ createTransport }));

const { sendEmail } = await import("./email");

const originalEnvironment = {
  EMAIL_FROM: process.env.EMAIL_FROM,
  EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT,
  MAILPIT_FROM_EMAIL: process.env.MAILPIT_FROM_EMAIL,
  MAILPIT_HOST: process.env.MAILPIT_HOST,
  MAILPIT_SMTP_PORT: process.env.MAILPIT_SMTP_PORT,
  NODE_ENV: process.env.NODE_ENV,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function setEnvironment(name: string, value: string) {
  process.env[name] = value;
}

function serializedLogCalls(): string {
  const values: unknown[] = [
    ...logError.mock.calls,
    ...logInfo.mock.calls,
    ...logWarn.mock.calls,
  ];

  function visit(value: unknown): string[] {
    if (value instanceof Error) {
      return [value.name, value.message, value.stack ?? ""];
    }
    if (Array.isArray(value)) return value.flatMap(visit);
    if (typeof value === "object" && value !== null) {
      return Object.entries(value).flatMap(([key, nested]) => [
        key,
        ...visit(nested),
      ]);
    }
    return [String(value)];
  }

  return values.flatMap(visit).join("\n");
}

beforeEach(() => {
  restoreEnvironment();
  setEnvironment("NODE_ENV", "test");

  resendSend.mockClear();
  resendSend.mockImplementation(async () => ({
    data: { id: "provider-message-id" },
    error: null,
  }));
  resendApiKeys.length = 0;
  createClient.mockClear();
  render.mockClear();
  logError.mockClear();
  logInfo.mockClear();
  logWarn.mockClear();
  sendMail.mockClear();
  sendMail.mockImplementation(async () => ({
    messageId: "<mailpit-message-id>",
  }));
  createTransport.mockClear();
});

afterAll(restoreEnvironment);

describe("shared email transport contract", () => {
  test("forwards chapter sender, reply-to, text, tags, and idempotency to Resend", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";

    const result = await sendEmail({
      to: ["student-one@example.test", "student-two@example.test"],
      subject: "Synthetic chapter notice",
      html: "<p>Chapter notice</p>",
      text: "Chapter notice",
      type: "transactional",
      from: "DVHS CSF <csf@notifications.lets-assist.com>",
      replyTo: "chapter-replies@example.test",
      tags: [
        { name: "chapter", value: "dvhs-csf" },
        { name: "message_kind", value: "application-decision" },
      ],
      idempotencyKey: "csf/application-decision/synthetic-1",
      attachments: [
        {
          filename: "decision.txt",
          content: "U3ludGhldGljIGF0dGFjaG1lbnQ=",
        },
      ],
    });

    expect(result).toEqual({
      success: true,
      data: { id: "provider-message-id" },
    });
    expect(resendApiKeys).toEqual(["synthetic-resend-key"]);
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0]).toEqual([
      {
        from: "DVHS CSF <csf@notifications.lets-assist.com>",
        to: ["student-one@example.test", "student-two@example.test"],
        subject: "Synthetic chapter notice",
        html: "<p>Chapter notice</p>",
        text: "Chapter notice",
        replyTo: "chapter-replies@example.test",
        tags: [
          { name: "chapter", value: "dvhs-csf" },
          { name: "message_kind", value: "application-decision" },
        ],
        attachments: [
          {
            filename: "decision.txt",
            content: "U3ludGhldGljIGF0dGFjaG1lbnQ=",
          },
        ],
      },
      { idempotencyKey: "csf/application-decision/synthetic-1" },
    ]);
  });

  test("keeps text-only operational messages valid", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic text-only notice",
      text: "This notice intentionally has no HTML representation.",
      type: "transactional",
    });

    expect(result.success).toBe(true);
    expect(resendSend.mock.calls[0]).toEqual([
      {
        from: "Let's Assist <projects@notifications.lets-assist.com>",
        to: "student@example.test",
        subject: "Synthetic text-only notice",
        text: "This notice intentionally has no HTML representation.",
        replyTo: undefined,
        tags: undefined,
        attachments: undefined,
      },
      undefined,
    ]);
  });

  test("preserves Mailpit delivery and exposes provider metadata as local headers", async () => {
    process.env.EMAIL_TRANSPORT = "mailpit";
    process.env.MAILPIT_HOST = "127.0.0.1";
    process.env.MAILPIT_SMTP_PORT = "54325";

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic local notice",
      html: "<p>Local HTML</p>",
      text: "Local text",
      type: "transactional",
      from: "DVHS CSF <csf@notifications.lets-assist.com>",
      replyTo: ["chapter-replies@example.test"],
      tags: [{ name: "chapter", value: "dvhs-csf" }],
      idempotencyKey: "csf/local/synthetic-1",
    });

    expect(result).toEqual({
      success: true,
      data: {
        id: "<mailpit-message-id>",
        transport: "mailpit",
      },
    });
    expect(createTransport).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 54325,
      secure: false,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "DVHS CSF <csf@notifications.lets-assist.com>",
      to: "student@example.test",
      subject: "Synthetic local notice",
      html: "<p>Local HTML</p>",
      text: "Local text",
      replyTo: ["chapter-replies@example.test"],
      headers: {
        "X-Lets-Assist-Idempotency-Key": "csf/local/synthetic-1",
        "X-Lets-Assist-Tag-chapter": "dvhs-csf",
      },
      attachments: undefined,
    });
  });

  test("never writes recipient, content, provider secrets, or durable keys to logs", async () => {
    const sensitiveValues = {
      apiKey: "resend-secret-that-must-not-be-logged",
      body: "private student body that must not be logged",
      from: "Private Sender <sender-private@example.test>",
      idempotencyKey: "private-idempotency-key",
      recipient: "student-private@example.test",
      replyTo: "private-reply@example.test",
      subject: "Private student subject",
      tagValue: "private-profile-reference",
      userId: "private-user-id",
    };

    setEnvironment("NODE_ENV", "development");
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = sensitiveValues.apiKey;
    resendSend.mockImplementation(async () => ({
      data: null,
      error: {
        name: "validation_error",
        message: `Provider response mentioned ${sensitiveValues.recipient} and ${sensitiveValues.apiKey}`,
      },
    }));

    const result = await sendEmail({
      to: sensitiveValues.recipient,
      subject: sensitiveValues.subject,
      text: sensitiveValues.body,
      type: "transactional",
      userId: sensitiveValues.userId,
      from: sensitiveValues.from,
      replyTo: sensitiveValues.replyTo,
      tags: [{ name: "profile", value: sensitiveValues.tagValue }],
      idempotencyKey: sensitiveValues.idempotencyKey,
    });

    expect(result.success).toBe(false);
    expect(logError).toHaveBeenCalledTimes(1);
    const logged = serializedLogCalls();

    for (const sensitiveValue of Object.values(sensitiveValues)) {
      expect(logged).not.toContain(sensitiveValue);
    }
    expect(logged).toContain("recipient_count");
    expect(logged).toContain("provider_error");
    expect(logged).toContain("validation_error");
  });
});
