import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { createWaiverAnalysisRequest } from "./waiver-ai-request";

describe("createWaiverAnalysisRequest", () => {
  test("binds a stable request key to the uploaded PDF digest", async () => {
    const file = new File(["waiver-pdf"], "waiver.pdf", {
      type: "application/pdf",
    });

    const request = await createWaiverAnalysisRequest(
      file,
      "018f47f2-b63a-7f2a-9d9e-8f0c5b6a7c8d",
    );

    expect(request.headers).toEqual({
      "Idempotency-Key": "018f47f2-b63a-7f2a-9d9e-8f0c5b6a7c8d",
      "X-Waiver-Content-SHA256": createHash("sha256")
        .update("waiver-pdf")
        .digest("hex"),
    });
    const uploaded = request.body.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded).toMatchObject({
      name: "waiver.pdf",
      type: "application/pdf",
      size: 10,
    });
    expect(await (uploaded as File).text()).toBe("waiver-pdf");
  });
});
