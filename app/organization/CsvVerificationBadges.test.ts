import { describe, expect, test } from "bun:test";

import {
  certificateStatusLabel,
  certificateTypeLabel,
} from "./CsvVerificationBadges";
import type { CertificateRow } from "./csv-verification-types";

function row(overrides: Partial<CertificateRow>): CertificateRow {
  return {
    certificateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectTitle: "Fictional cleanup",
    organizationName: "Fictional organization",
    organizerName: "Fictional supervisor",
    certificationStatus: "Certified",
    valid: true,
    issues: [],
    ...overrides,
  };
}

describe("the status label says only what the lookup established", () => {
  test("a lookup that could not answer is unavailable, never not found", () => {
    expect(
      certificateStatusLabel(
        row({
          verificationStatus: "unavailable",
          verificationResult: { valid: false, retryable: true },
          isVerified: false,
        }),
      ),
    ).toBe("Unavailable");
  });

  test("not found is shown only for an explicit missing-certificate answer", () => {
    expect(
      certificateStatusLabel(
        row({
          verificationStatus: "failed",
          verificationResult: { valid: false, exists: false },
          isVerified: false,
        }),
      ),
    ).toBe("Not found");
    expect(
      certificateStatusLabel(
        row({
          verificationStatus: "failed",
          verificationResult: { valid: false, error: "Rejected" },
          isVerified: false,
        }),
      ),
    ).toBe("Not verified");
  });

  test("a found certificate is verified or a data mismatch", () => {
    expect(
      certificateStatusLabel(
        row({ verificationStatus: "verified", isVerified: true }),
      ),
    ).toBe("Verified");
    expect(
      certificateStatusLabel(
        row({ verificationStatus: "verified", isVerified: false }),
      ),
    ).toBe("Data mismatch");
  });
});

describe("the type label keeps the legacy verified alias", () => {
  test("a verified record tagged with the old type name reads as a platform type", () => {
    const verified = (type: string, certified: boolean) =>
      row({
        verificationStatus: "verified",
        isVerified: true,
        verificationResult: {
          valid: true,
          exists: true,
          certificate: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            certified,
            type,
            recipient: { name: null, email: null },
          },
        },
      });

    expect(certificateTypeLabel(verified("verified", true))).toBe("Official");
    expect(certificateTypeLabel(verified("verified", false))).toBe("Platform");
    expect(certificateTypeLabel(verified("self-reported", false))).toBe(
      "Self-reported",
    );
  });
});
