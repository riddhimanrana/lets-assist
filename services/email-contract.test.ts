import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type MockResendResponse = {
  data: { id: string } | null;
  error: { name: string; message: string; statusCode?: number | null } | null;
  headers?: Record<string, string> | null;
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

let constructorImpl: ((apiKey: string) => void) | null = null;

class MockResend {
  readonly emails = { send: resendSend };

  constructor(apiKey: string) {
    resendApiKeys.push(apiKey);
    constructorImpl?.(apiKey);
  }
}

const createClient = mock(async () => {
  throw new Error(
    "notification settings should not be queried in transactional tests",
  );
});
const render = mock(async () => "<p>rendered React email</p>");
const logError = mock(() => undefined);
const logInfo = mock(() => undefined);
const logWarn = mock(() => undefined);
const sendMail = mock(async () => ({ messageId: "<mailpit-message-id>" }));
const createTransport = mock(() => ({ sendMail }));

mock.module("resend", () => ({ Resend: MockResend }));
mock.module("@/lib/supabase/server", () => ({ createClient }));
mock.module("react-email", () => ({ render }));
mock.module("@/lib/logger", () => ({ logError, logInfo, logWarn }));
mock.module("nodemailer", () => ({ createTransport }));

const {
  classifyProviderError,
  getResendClient,
  parseRetryAfterSeconds,
  sendEmail,
} = await import("./email");

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
  constructorImpl = null;
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
  createTransport.mockImplementation(() => ({ sendMail }));
});

afterAll(restoreEnvironment);

describe("shared email transport contract", () => {
  test("constructs the sending client only from its send credential", () => {
    process.env.RESEND_API_KEY = "synthetic-send-key";

    expect(getResendClient().ok).toBe(true);
    expect(resendApiKeys).toEqual(["synthetic-send-key"]);
  });

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

    expect(result).toMatchObject({
      outcome: "accepted",
      success: true,
      skipped: false,
      phase: "provider_response",
      messageId: "provider-message-id",
      transport: "resend",
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

  test("forwards exact provider headers so a hashed payload can actually be sent", async () => {
    // The CSF ledger hashes the COMPLETE canonical provider request, headers
    // included, and derives the attempt's idempotency key from that digest. If the
    // transport dropped headers, the request sent would differ from the one the
    // stored key was allocated against.
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";

    const result = await sendEmail({
      to: "adviser@example.test",
      subject: "Synthetic tagged send",
      text: "Body",
      type: "transactional",
      headers: { "X-CSF-Attempt": "synthetic-attempt-1" },
      tags: [{ name: "csf_plugin", value: "dvhs_csf" }],
      idempotencyKey: "csf-att-synthetic-1",
    });

    expect(result.success).toBe(true);
    expect(resendSend.mock.calls[0][0]).toMatchObject({
      headers: { "X-CSF-Attempt": "synthetic-attempt-1" },
      tags: [{ name: "csf_plugin", value: "dvhs_csf" }],
    });
  });

  test("omitting headers leaves the outbound request shape unchanged", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";

    await sendEmail({
      to: "adviser@example.test",
      subject: "Synthetic untagged send",
      text: "Body",
      type: "transactional",
    });

    expect(
      Object.prototype.hasOwnProperty.call(
        resendSend.mock.calls[0][0] as Record<string, unknown>,
        "headers",
      ),
    ).toBe(false);
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

    expect(result).toMatchObject({
      outcome: "accepted",
      success: true,
      phase: "provider_response",
      messageId: "<mailpit-message-id>",
      transport: "mailpit",
      data: {
        id: "<mailpit-message-id>",
        transport: "mailpit",
      },
    });
    expect(createTransport).toHaveBeenCalledWith({
      disableFileAccess: true,
      disableUrlAccess: true,
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

  // ---------------------------------------------------------------------------
  // Transport outcomes are represented honestly.
  //
  // The distinction every one of these fixtures exists to pin down is whether the
  // request could possibly have been ACCEPTED. Collapsing them to a boolean is what
  // forces a caller to choose between losing mail and sending it twice.
  // ---------------------------------------------------------------------------

  test("local validation before the request is a definitive failure", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic notice with no body at all",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "local_validation",
      code: "missing_body",
    });
    // Nothing reached the provider, which is the point of the phase.
    expect(resendSend).toHaveBeenCalledTimes(0);
  });

  test("a definitive HTTP rejection is not retryable", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    resendSend.mockImplementation(async () => ({
      data: null,
      error: {
        name: "validation_error",
        message: "The from address is not verified for student@example.test",
        statusCode: 422,
      },
    }));

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic rejected notice",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "definitive_failure",
      success: false,
      phase: "provider_response",
      code: "validation_error",
      status: 422,
    });
    // The provider's message named the recipient; the sanitized summary must not.
    expect(String(result.error)).not.toContain("student@example.test");
  });

  test("a throttled rejection is retryable because nothing was accepted", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    resendSend.mockImplementation(async () => ({
      data: null,
      error: {
        name: "rate_limit_exceeded",
        message: "Too many requests",
        statusCode: 429,
      },
      headers: { "retry-after": "120" },
    }));

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic throttled notice",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "retryable_pre_send",
      success: false,
      phase: "provider_response",
      code: "rate_limit_exceeded",
      status: 429,
      retryAfterSeconds: 120,
    });
  });

  test("parses bounded Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfterSeconds({ "Retry-After": "45" }, 0)).toBe(45);
    expect(parseRetryAfterSeconds({ "retry-after": "999999" }, 0)).toBe(
      86_400,
    );
    expect(
      parseRetryAfterSeconds(
        { "retry-after": "Thu, 01 Jan 1970 00:02:00 GMT" },
        60_001,
      ),
    ).toBe(60);
    expect(parseRetryAfterSeconds({ "retry-after": "later" }, 0)).toBeNull();
  });

  test("uses a conservative delay when a throttled response omits Retry-After", () => {
    expect(
      classifyProviderError({
        name: "rate_limit_exceeded",
        statusCode: 429,
      }),
    ).toMatchObject({
      outcome: "retryable_pre_send",
      retryAfterSeconds: 60,
    });
  });

  test("a provider-side fault is an unknown outcome, never a retry", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    resendSend.mockImplementation(async () => ({
      data: null,
      error: {
        name: "internal_server_error",
        message: "Something went wrong",
        statusCode: 500,
      },
    }));

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic ambiguous notice",
      text: "Body",
      type: "transactional",
    });

    // A 5xx may have been accepted before the failure. Retrying can double-send.
    expect(result).toMatchObject({
      outcome: "unknown_outcome",
      success: false,
      phase: "provider_response",
      code: "internal_server_error",
    });
  });

  test("an unrecognized provider error is ambiguous rather than assumed safe", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    resendSend.mockImplementation(async () => ({
      data: null,
      error: { name: "some_future_error_code", message: "New failure mode" },
    }));

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic future error",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({ outcome: "unknown_outcome" });
  });

  test("a timeout or reset after dispatch is an unknown outcome at the request phase", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    resendSend.mockImplementation(async () => {
      // Control left the process inside emails.send(). Whether Resend received and
      // queued the request before the socket died is unknowable from here.
      const reset = new Error("socket hang up for student@example.test");
      reset.name = "ECONNRESET";
      throw reset;
    });

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic reset notice",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "unknown_outcome",
      success: false,
      phase: "provider_request",
      code: "transport_exception",
    });
    expect(String(result.error)).not.toContain("student@example.test");
  });

  test("a 2xx with no message identity is unknown, not success", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    resendSend.mockImplementation(async () => ({ data: null, error: null }));

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic unnamed acceptance",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "unknown_outcome",
      code: "missing_provider_message_id",
    });
  });

  test("a provider client that cannot be constructed is a pre-send fault, not ambiguity", async () => {
    // A key is present, so somebody meant to send. The SDK refusing to build a
    // client opens no socket, so nothing can have been accepted -- classifying it as
    // unknown_outcome would make the CSF ledger treat it as terminal and demand a
    // human reconciliation for a message that never existed.
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    constructorImpl = () => {
      throw new Error("Missing API key. Pass it to the constructor");
    };

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic setup failure",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "retryable_pre_send",
      success: false,
      skipped: false,
      phase: "transport_setup",
      code: "resend_client_setup_failed",
    });
    expect(result.outcome).not.toBe("unknown_outcome");
    expect(resendSend).toHaveBeenCalledTimes(0);
  });

  test("an unusable local transport port is a definitive local failure", async () => {
    process.env.EMAIL_TRANSPORT = "mailpit";
    process.env.MAILPIT_SMTP_PORT = "not-a-port";

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic bad port",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "definitive_failure",
      phase: "transport_setup",
      code: "mailpit_port_invalid",
    });
    expect(createTransport).toHaveBeenCalledTimes(0);
  });

  test("a local transport that cannot be constructed is retryable pre-send, never unknown", async () => {
    process.env.EMAIL_TRANSPORT = "mailpit";
    createTransport.mockImplementation(() => {
      throw new Error("bad transport options");
    });

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic transport setup failure",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "retryable_pre_send",
      phase: "transport_setup",
      code: "mailpit_transport_setup_failed",
    });
    expect(result.outcome).not.toBe("unknown_outcome");
    // Nothing was dispatched, so nothing is ambiguous.
    expect(sendMail).toHaveBeenCalledTimes(0);
  });

  test("the local transporter disables file and URL content access", async () => {
    process.env.EMAIL_TRANSPORT = "mailpit";
    process.env.MAILPIT_HOST = "127.0.0.1";
    process.env.MAILPIT_SMTP_PORT = "54325";

    await sendEmail({
      to: "student@example.test",
      subject: "Synthetic hardened local send",
      text: "Body",
      type: "transactional",
    });

    // GHSA-p6gq-j5cr-w38f: nodemailer will read a local path or fetch a URL from a
    // message part unless both are disabled. This wrapper only ever sends inline
    // content, so leaving them on is a pure local-file-read/SSRF primitive.
    expect(createTransport).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 54325,
      secure: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  test("a transport that is not configured is skipped, not failed", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    delete process.env.RESEND_API_KEY;

    const result = await sendEmail({
      to: "student@example.test",
      subject: "Synthetic unconfigured notice",
      text: "Body",
      type: "transactional",
    });

    expect(result).toMatchObject({
      outcome: "skipped",
      success: false,
      skipped: true,
      phase: "transport_setup",
      code: "transport_not_configured",
    });
    expect(resendSend).toHaveBeenCalledTimes(0);
  });

  test("the sanitized error summary is always a string, never a raw cause", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "synthetic-resend-key";

    const causes: Array<() => Promise<MockResendResponse>> = [
      async () => ({
        data: null,
        error: { name: "validation_error", message: "x", statusCode: 422 },
      }),
      async () => {
        throw new Error("raw cause with secret-token-value");
      },
    ];

    for (const cause of causes) {
      resendSend.mockImplementation(cause);
      const result = await sendEmail({
        to: "student@example.test",
        subject: "Synthetic sanitization check",
        text: "Body",
        type: "transactional",
      });

      // The TYPE permits Error for backward compatibility with existing narrowing
      // call sites; the runtime never produces one.
      expect(typeof result.error).toBe("string");
      expect(result.error).not.toBeInstanceOf(Error);
      expect(String(result.error)).not.toContain("secret-token-value");
    }
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
