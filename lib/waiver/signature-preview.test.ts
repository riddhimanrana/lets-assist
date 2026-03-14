import { describe, expect, it } from "vitest";

import { buildSignaturePreviewSummary } from "@/lib/waiver/signature-preview";

describe("buildSignaturePreviewSummary", () => {
  it("returns null when a signature payload has no signers", () => {
    expect(buildSignaturePreviewSummary(null)).toBeNull();
    expect(buildSignaturePreviewSummary({ signers: [], fields: {} })).toBeNull();
  });

  it("keeps only organizer-facing signer metadata", () => {
    const summary = buildSignaturePreviewSummary({
      signers: [
        {
          role_key: "volunteer",
          method: "draw",
          data: "waiver-signatures/volunteer.png",
          timestamp: "2026-03-07T12:00:00.000Z",
          signer_name: "Ada Lovelace",
          signer_email: "ada@example.com",
        },
        {
          role_key: "parent_guardian",
          method: "typed",
          data: "Parent Signature",
          timestamp: "2026-03-07T12:05:00.000Z",
        },
      ],
      fields: {
        printed_name: "Ada Lovelace",
      },
    });

    expect(summary).toEqual({
      signerCount: 2,
      signers: [
        {
          role_key: "volunteer",
          method: "draw",
          timestamp: "2026-03-07T12:00:00.000Z",
          signer_name: "Ada Lovelace",
          signer_email: "ada@example.com",
        },
        {
          role_key: "parent_guardian",
          method: "typed",
          timestamp: "2026-03-07T12:05:00.000Z",
        },
      ],
    });

    expect(JSON.stringify(summary)).not.toContain("waiver-signatures/volunteer.png");
    expect(JSON.stringify(summary)).not.toContain("Parent Signature");
    expect(JSON.stringify(summary)).not.toContain("printed_name");
  });
});