import { describe, expect, test } from "bun:test";

import {
  filenameFromContentDisposition,
  waiverResponseError,
} from "./download-signed-waiver";
import { getContentDisposition } from "./preview-auth-helpers";

describe("filenameFromContentDisposition", () => {
  test("takes the name the route chose, with its real extension", () => {
    expect(
      filenameFromContentDisposition(
        getContentDisposition(false, "abc-123", "image/jpeg"),
        "fallback",
      ),
    ).toBe("signed-waiver-abc-123.jpg");
    expect(
      filenameFromContentDisposition(
        getContentDisposition(false, "abc-123", "application/pdf"),
        "fallback",
      ),
    ).toBe("signed-waiver-abc-123.pdf");
  });

  test("reads unquoted and encoded forms", () => {
    expect(
      filenameFromContentDisposition("attachment; filename=waiver.png", "x"),
    ).toBe("waiver.png");
    expect(
      filenameFromContentDisposition(
        "attachment; filename=\"a.pdf\"; filename*=UTF-8''signed%20copy.png",
        "x",
      ),
    ).toBe("signed copy.png");
  });

  test("falls back when the header is missing or names nothing usable", () => {
    expect(filenameFromContentDisposition(null, "signed-waiver")).toBe(
      "signed-waiver",
    );
    expect(filenameFromContentDisposition("attachment", "signed-waiver")).toBe(
      "signed-waiver",
    );
    expect(
      filenameFromContentDisposition('attachment; filename="///"', "fallback"),
    ).toBe("fallback");
  });

  test("never yields a path or a hidden file", () => {
    expect(
      filenameFromContentDisposition(
        'attachment; filename="../../.ssh/authorized_keys"',
        "fallback",
      ),
    ).toBe("sshauthorized_keys");
  });
});

describe("waiverResponseError", () => {
  test("surfaces the sentence the route sent", async () => {
    const response = Response.json(
      { error: "You do not have access to this signed waiver." },
      { status: 403 },
    );
    expect(await waiverResponseError(response)).toBe(
      "You do not have access to this signed waiver.",
    );
  });

  test("uses a generic sentence for anything else", async () => {
    for (const response of [
      new Response("<html>", { status: 502 }),
      Response.json({ error: "" }, { status: 500 }),
      Response.json({ message: "nope" }, { status: 500 }),
    ]) {
      expect(await waiverResponseError(response)).toBe(
        "The signed waiver could not be downloaded. Please try again.",
      );
    }
  });
});
