import { expect, test } from "bun:test";
import nodemailer from "nodemailer";

test("the local mail transport keeps comment suffixes out of recipients", async () => {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const message = await transport.sendMail({
    from: "sender@example.invalid",
    to: '"volunteer"@example.invalid(comment)other.invalid',
    subject: "Synthetic parser regression",
    text: "No network transport is used.",
  });

  expect(message.envelope.to).toEqual(["volunteer@example.invalid"]);
  expect(Buffer.isBuffer(message.message)).toBe(true);
});
