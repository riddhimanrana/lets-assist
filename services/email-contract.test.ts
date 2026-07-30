import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.join(process.cwd(), "services/email.ts"), "utf8");

describe("shared email transport contract", () => {
  test("supports the CSF sender, reply, text, tags, and durable idempotency inputs", () => {
    for (const field of [
      "text?: string",
      "from?: string",
      "replyTo?: string | string[]",
      "tags?: EmailTag[]",
      "idempotencyKey?: string",
    ]) {
      expect(source).toContain(field);
    }

    expect(source).toContain(
      "idempotencyKey ? { idempotencyKey } : undefined",
    );
    expect(source).toContain("replyTo,");
    expect(source).toContain("tags,");
  });

  test("keeps local delivery in Mailpit with the same visible message contract", () => {
    expect(source).toMatch(
      /sendViaMailpit\(\{[\s\S]*html: emailHtml,[\s\S]*text,[\s\S]*from,[\s\S]*replyTo,[\s\S]*tags,[\s\S]*idempotencyKey,/,
    );
    expect(source).toContain("X-Lets-Assist-Idempotency-Key");
    expect(source).toContain("X-Lets-Assist-Tag-");
  });

  test("accepts text-only operational messages without weakening preference checks", () => {
    expect(source).toContain("if (!html && !react && !text)");
    expect(source).toContain("if (userId && type !== 'transactional')");
    expect(source).toContain("const content = emailHtml");
    expect(source).toContain(": { text: text! }");
  });
});
