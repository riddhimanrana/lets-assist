import { describe, expect, test } from "bun:test";

import {
  MATCH_AUTO_THRESHOLD,
  bigramDiceSimilarity,
  matchPaperRow,
  normalizeEmail,
  normalizeIdentityText,
  normalizePhoneDigits,
  type PaperMatchCandidate,
} from "./matching";

function candidate(
  overrides: Partial<PaperMatchCandidate>,
): PaperMatchCandidate {
  return {
    signupId: null,
    userId: null,
    anonymousId: null,
    name: null,
    email: null,
    phone: null,
    ...overrides,
  };
}

describe("normalizeIdentityText", () => {
  test("strips accents, case, punctuation, and extra whitespace", () => {
    expect(normalizeIdentityText("  José  Núñez-García ")).toBe(
      "jose nunez garcia",
    );
    expect(normalizeIdentityText("O'Brien,  Mary")).toBe("o brien mary");
    expect(normalizeIdentityText(null)).toBe("");
  });
});

describe("normalizePhoneDigits", () => {
  test("keeps digits and drops a leading US country code", () => {
    expect(normalizePhoneDigits("+1 (555) 010-1234")).toBe("5550101234");
    expect(normalizePhoneDigits("555.010.1234")).toBe("5550101234");
  });

  test("rejects numbers with fewer than 10 digits", () => {
    expect(normalizePhoneDigits("555-0101")).toBeNull();
    expect(normalizePhoneDigits(null)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  test("lowercases and trims; rejects non-emails", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
});

describe("bigramDiceSimilarity", () => {
  test("identical strings are 1, disjoint strings are 0", () => {
    expect(bigramDiceSimilarity("night", "night")).toBe(1);
    expect(bigramDiceSimilarity("abc", "xyz")).toBe(0);
  });

  test("is symmetric and handles short inputs", () => {
    expect(bigramDiceSimilarity("night", "nacht")).toBe(
      bigramDiceSimilarity("nacht", "night"),
    );
    expect(bigramDiceSimilarity("a", "a")).toBe(1);
    expect(bigramDiceSimilarity("a", "b")).toBe(0);
    expect(bigramDiceSimilarity("", "")).toBe(0);
  });
});

describe("matchPaperRow", () => {
  test("exact email wins over a better name match elsewhere", () => {
    const byName = candidate({
      signupId: "signup-name",
      name: "Jane Doe",
      email: "other@example.com",
    });
    const byEmail = candidate({
      signupId: "signup-email",
      name: "Completely Different",
      email: "jane@example.com",
    });

    const result = matchPaperRow(
      { name: "Jane Doe", email: "jane@example.com", phone: null },
      [byName, byEmail],
    );

    expect(result.signupId).toBe("signup-email");
    expect(result.score).toBe(1);
    expect(result.reasons).toEqual(["exact_email"]);
  });

  test("swapped given and family names still match strongly", () => {
    const result = matchPaperRow(
      { name: "Doe Jane", email: null, phone: null },
      [candidate({ userId: "user-1", name: "Jane Doe" })],
    );
    expect(result.userId).toBe("user-1");
    expect(result.score).toBe(0.85);
    expect(result.reasons).toEqual(["swapped_name"]);
  });

  test("Bob vs Robert does not cross the auto threshold", () => {
    const result = matchPaperRow(
      { name: "Bob Smith", email: null, phone: null },
      [candidate({ userId: "user-1", name: "Robert Smith" })],
    );
    expect(result.score).toBeLessThan(MATCH_AUTO_THRESHOLD);
  });

  test("exact phone plus a similar name is a strong match", () => {
    const result = matchPaperRow(
      { name: "Jane D", email: null, phone: "(555) 010-1234" },
      [
        candidate({
          userId: "user-1",
          name: "Jane Doe",
          phone: "+1 555 010 1234",
        }),
      ],
    );
    expect(result.score).toBe(0.95);
    expect(result.reasons).toContain("exact_phone");
  });

  test("exact full name scores 0.90 and crosses the auto threshold", () => {
    const result = matchPaperRow(
      { name: "José Núñez", email: null, phone: null },
      [candidate({ anonymousId: "anon-1", name: "Jose Nunez" })],
    );
    expect(result.anonymousId).toBe("anon-1");
    expect(result.score).toBe(0.9);
    expect(result.score).toBeGreaterThanOrEqual(MATCH_AUTO_THRESHOLD);
  });

  test("weak similarity returns no match", () => {
    const result = matchPaperRow(
      { name: "Alice Wonder", email: null, phone: null },
      [candidate({ userId: "user-1", name: "Zed Zebra" })],
    );
    expect(result.kind).toBe("none");
    expect(result.score).toBe(0);
  });

  test("empty candidate list returns no match", () => {
    const result = matchPaperRow(
      { name: "Jane Doe", email: "jane@example.com", phone: null },
      [],
    );
    expect(result.kind).toBe("none");
  });

  test("candidate kind reflects the strongest identity available", () => {
    const result = matchPaperRow(
      { name: null, email: "jane@example.com", phone: null },
      [
        candidate({
          signupId: "signup-1",
          userId: "user-1",
          email: "jane@example.com",
        }),
      ],
    );
    expect(result.kind).toBe("existing_signup");
  });

  test("ties keep the earliest candidate", () => {
    const result = matchPaperRow(
      { name: "Jane Doe", email: null, phone: null },
      [
        candidate({ signupId: "first", name: "Jane Doe" }),
        candidate({ signupId: "second", name: "Jane Doe" }),
      ],
    );
    expect(result.signupId).toBe("first");
  });
});
