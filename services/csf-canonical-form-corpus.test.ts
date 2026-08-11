import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

mock.module("server-only", () => ({}));

const {
  CsfCanonicalFormError,
  csfCanonicalDigest,
  csfCanonicalJson,
  csfCanonicalNumber,
  isCsfCanonicalNumberLiteral,
  parseCsfCanonicalJsonText,
} = await import("./csf-import-contract");

/**
 * The pinned canonical-form corpus.
 *
 * Every expected string and every digest below is a LITERAL. None of it is
 * produced by either implementation at test time -- not by `csfCanonicalJson`,
 * not by PostgreSQL, and not by hashing one side's output to check the other.
 * That is the whole point: a corpus computed from the production serializer
 * cannot detect the production serializer being wrong, and a corpus generated
 * from one side at runtime cannot detect the two sides disagreeing.
 *
 * The digests are SHA-256 over the canonical UTF-8 bytes and were produced
 * independently of this module. The SQL mirror --
 * `plugin_data.csf_canonical_json(jsonb)` and
 * `plugin_data.csf_canonical_digest(jsonb)` -- is held to the same literals by
 * the pgTAP contract, which is what makes these two implementations comparable
 * without either being the other's oracle.
 */

/** JSON number literals that survive binary64 exactly, and their JCS spelling. */
const ACCEPTED_NUMBERS: ReadonlyArray<
  readonly [literal: string, canonical: string]
> = [
  ["0", "0"],
  ["-0", "0"],
  ["1", "1"],
  ["1.0", "1"],
  ["-1", "-1"],
  ["0.5", "0.5"],
  ["1.25", "1.25"],
  ["0.1", "0.1"],
  ["-0.0", "0"],
  // Safe-integer boundaries.
  ["9007199254740991", "9007199254740991"],
  ["-9007199254740991", "-9007199254740991"],
  ["9007199254740992", "9007199254740992"],
  // The exponent thresholds ECMAScript switches spelling at. PostgreSQL's own
  // float8out prints 1e-06, 1e-07, 1e+20 and 1e+21 for all four of these, so a
  // `jsonb::text` digest would disagree with JavaScript on three of them.
  ["1e-6", "0.000001"],
  ["1e-7", "1e-7"],
  ["1e20", "100000000000000000000"],
  ["1e21", "1e+21"],
  ["1e-5", "0.00001"],
  ["123456789012345680000", "123456789012345680000"],
  // Subnormal and finite extremes.
  ["5e-324", "5e-324"],
  ["1.7976931348623157e308", "1.7976931348623157e+308"],
  ["-1.7976931348623157e308", "-1.7976931348623157e+308"],
  ["2.2250738585072014e-308", "2.2250738585072014e-308"],
];

/** Literals PostgreSQL `numeric` holds but binary64 cannot. */
const REJECTED_NUMBERS: readonly string[] = [
  // Rounds to ...992 in JavaScript. Kept exactly by PostgreSQL. The canonical
  // collision this contract exists to refuse.
  "9007199254740993",
  // Rounds to 1 in JavaScript.
  "1.0000000000000001",
  "1.00000000000000011102230246251565404236316680908203125000001",
  // Below the smallest subnormal: rounds to zero.
  "1e-400",
  // Above the largest finite double: overflows to Infinity.
  "1e400",
  "-1e400",
  "179769313486231580793728971405303415079934132710037826936173778980444968292764750946649017977587207096330286416692887910946555547851940402630657488671505820681908902000708383676273854845817711531764475730270069855571366959622842914819860834936475292719074168444365510704342711559699508093042880177904174497792.1",
];

/** Object corpora, with their literal canonical form and literal SHA-256. */
const OBJECT_CORPUS: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly canonical: string;
  readonly digest: string;
}> = [
  {
    label: "empty object",
    value: {},
    canonical: "{}",
    digest: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  },
  {
    // 'A'(0x41) < 'B'(0x42) < 'a'(0x61) < 'z'(0x7a), and within 'A' the second
    // unit decides: '0'(0x30) < 'l'(0x6c). Uppercase sorting before lowercase is
    // the property PostgreSQL's default collation does NOT have, which is why
    // the SQL mirror orders with COLLATE "C".
    label: "key ordering is by code unit, not insertion",
    value: { zeta: 1, Alpha: 2, alpha: 3, Beta: 4, A0: 5 },
    canonical: '{"A0":5,"Alpha":2,"Beta":4,"alpha":3,"zeta":1}',
    digest: "7dff6a55c9bc12ba7e8418a8f024a0ea138630474fb2bb06d4541ad9d3f743d7",
  },
  {
    label: "roster identity record",
    value: {
      identity: {
        firstName: "Avery",
        lastName: "Sample",
        normalizedFirstName: "avery",
        normalizedLastName: "sample",
      },
      contact: {
        schoolEmail: "avery.sample@school.test",
        schoolEmailState: "valid",
      },
      cohort: { gradeLevel: 11 },
    },
    canonical:
      '{"cohort":{"gradeLevel":11},"contact":{"schoolEmail":"avery.sample@school.test","schoolEmailState":"valid"},"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample"}}',
    digest: "da64f84c3876b5fffa75a632fb2f659f05b7a95cfd8214e303db45e78626d608",
  },
  {
    label: "nested arrays and nullability",
    value: {
      activities: [
        { label: "Tutoring", points: 2 },
        { label: "Blood drive", points: 1.5 },
      ],
      meetings: [{ key: "meeting_1", state: "X" }],
      requirements: { allRequirementsMet: null },
      empty: [],
    },
    canonical:
      '{"activities":[{"label":"Tutoring","points":2},{"label":"Blood drive","points":1.5}],"empty":[],"meetings":[{"key":"meeting_1","state":"X"}],"requirements":{"allRequirementsMet":null}}',
    digest: "628dc2c349a8a5ba82b937b56487c0ae2f82ed9ec66987b3338f338de86f4c69",
  },
  {
    label: "string escaping, control characters and non-ASCII",
    value: {
      quote: 'a"b',
      backslash: "a\\b",
      newline: "a\nb",
      tab: "a\tb",
      unit: "a\u001fb",
      // Written as escapes, not as literal characters: a precomposed and a
      // decomposed "e-acute" are different byte sequences with different
      // digests, and which one a file holds is an editor decision.
      emoji: "caf\u00e9 \u{1F600}",
    },
    canonical:
      '{"backslash":"a\\\\b","emoji":"caf\u00e9 \u{1F600}","newline":"a\\nb","quote":"a\\"b","tab":"a\\tb","unit":"a\\u001fb"}',
    digest: "8df835a966a409534a02cb90b8f530fe3e849d1e2e886f0184ee643bd16a90aa",
  },
];

describe("canonical number serialization (RFC 8785 §3.2.2.3)", () => {
  test.each(ACCEPTED_NUMBERS)(
    "%s canonicalizes to %s",
    (literal, canonical) => {
      expect(isCsfCanonicalNumberLiteral(literal)).toBe(true);
      expect(csfCanonicalNumber(Number(literal))).toBe(canonical);
    },
  );

  test.each(REJECTED_NUMBERS.map((literal) => [literal]))(
    "%s is refused before hashing",
    (literal) => {
      expect(isCsfCanonicalNumberLiteral(literal)).toBe(false);
      expect(() => parseCsfCanonicalJsonText(`{"points":${literal}}`)).toThrow(
        CsfCanonicalFormError,
      );
    },
  );

  test("non-finite values have no canonical form", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => csfCanonicalNumber(value)).toThrow(CsfCanonicalFormError);
    }
  });

  test("-0 and 0 are one number with one spelling", () => {
    expect(csfCanonicalNumber(-0)).toBe("0");
    expect(csfCanonicalNumber(0)).toBe("0");
    expect(csfCanonicalJson({ a: -0 } as never)).toBe('{"a":0}');
    // The two therefore cannot produce different digests for one stored value.
    expect(csfCanonicalDigest({ a: -0 } as never)).toBe(
      csfCanonicalDigest({ a: 0 } as never),
    );
  });

  test("the exact thresholds where ECMAScript changes spelling", () => {
    // Below 1e-6 ECMAScript switches to exponent form; at 1e21 it switches
    // again. PostgreSQL float8out switches at neither, which is why this is a
    // pinned contract and not an implementation detail.
    expect(csfCanonicalNumber(1e-6)).toBe("0.000001");
    expect(csfCanonicalNumber(1e-7)).toBe("1e-7");
    expect(csfCanonicalNumber(1e20)).toBe("100000000000000000000");
    expect(csfCanonicalNumber(1e21)).toBe("1e+21");
  });

  test("a precision collision cannot be smuggled through as two different values", () => {
    // Both literals denote the same double, so they must produce one canonical
    // form -- but only the one that IS that double's shortest spelling is
    // accepted as input.
    expect(isCsfCanonicalNumberLiteral("0.1")).toBe(true);
    expect(
      isCsfCanonicalNumberLiteral("0.1000000000000000055511151231257827"),
    ).toBe(false);
    expect(Number("0.1000000000000000055511151231257827")).toBe(0.1);
  });
});

describe("canonical object form", () => {
  test.each(OBJECT_CORPUS.map((entry) => [entry.label, entry] as const))(
    "%s serializes to its pinned canonical string",
    (_label, entry) => {
      expect(csfCanonicalJson(entry.value as never)).toBe(entry.canonical);
    },
  );

  test.each(OBJECT_CORPUS.map((entry) => [entry.label, entry] as const))(
    "%s hashes to its pinned digest",
    (_label, entry) => {
      // The digest is over the pinned canonical string's UTF-8 bytes and was
      // computed outside this module, so this is a comparison against an
      // external fact rather than against the serializer's own output.
      expect(csfCanonicalDigest(entry.value as never)).toBe(entry.digest);
    },
  );

  test("a one-byte change to a pinned digest is rejected", () => {
    for (const entry of OBJECT_CORPUS) {
      const mutated = `${entry.digest.slice(0, -1)}${entry.digest.endsWith("0") ? "1" : "0"}`;
      expect(csfCanonicalDigest(entry.value as never)).not.toBe(mutated);
    }
  });

  test("key-order permutations of one record collapse to one canonical string", () => {
    const forward = { alpha: 1, beta: 2, gamma: 3 };
    const reversed = { gamma: 3, beta: 2, alpha: 1 };
    const interleaved = { beta: 2, alpha: 1, gamma: 3 };
    const expected = '{"alpha":1,"beta":2,"gamma":3}';
    for (const permutation of [forward, reversed, interleaved]) {
      expect(csfCanonicalJson(permutation as never)).toBe(expected);
    }
    expect(
      new Set(
        [forward, reversed, interleaved].map((v) =>
          csfCanonicalDigest(v as never),
        ),
      ).size,
    ).toBe(1);
  });

  test.each([
    ["a changed key", { alpha: 1, beta: 2 }, { alpha: 1, Beta: 2 }],
    ["a changed escape", { a: 'x"y' }, { a: "x\\y" }],
    ["a changed exponent", { a: 1e-6 }, { a: 1e-7 }],
    ["a changed magnitude", { a: 1e20 }, { a: 1e21 }],
    ["a nested reordering that changes a value", { a: [1, 2] }, { a: [2, 1] }],
  ])("one-fault mutation of %s changes the digest", (_label, left, right) => {
    expect(csfCanonicalJson(left as never)).not.toBe(
      csfCanonicalJson(right as never),
    );
    expect(csfCanonicalDigest(left as never)).not.toBe(
      csfCanonicalDigest(right as never),
    );
  });

  test("a non-canonical key is refused rather than silently reordered", () => {
    // JCS orders by UTF-16 code unit and PostgreSQL has no UTF-16 collation, so
    // the key charset is narrowed to the range where "C" byte order and UTF-16
    // order are the same sequence. That narrowing is enforced, not assumed.
    for (const key of ["ünicode", "with space", "0leading", "a-b", ""]) {
      expect(() => csfCanonicalJson({ [key]: 1 } as never)).toThrow(
        CsfCanonicalFormError,
      );
    }
  });

  test("undefined and non-JSON values have no canonical form", () => {
    expect(() => csfCanonicalJson({ a: undefined } as never)).toThrow(
      CsfCanonicalFormError,
    );
    expect(() => csfCanonicalJson({ a: BigInt(1) } as never)).toThrow(
      CsfCanonicalFormError,
    );
  });
});

describe("the SQL mirror is held to the same pinned corpus", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL(
        "../supabase/migrations/20260730001004_dvhs_csf_import_commit_recovery.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  test("PostgreSQL implements ECMAScript Number::toString, not float8out", () => {
    const fn = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_js_number_text(",
      ),
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_number_text(",
      ),
    );
    expect(fn).toBeTruthy();
    // The four branches of §6.1.6.1.20, in order.
    expect(fn).toContain("WHEN v_k <= v_n AND v_n <= 21 THEN");
    expect(fn).toContain("WHEN 0 < v_n AND v_n <= 21 THEN");
    expect(fn).toContain("WHEN -6 < v_n AND v_n <= 0 THEN");
    // Exponent sign and magnitude, without PostgreSQL's zero padding.
    expect(fn).toContain("pg_catalog.abs(v_n - 1)::text");
    // A session GUC may not change a digest.
    expect(fn).toContain("SET extra_float_digits = 1");
  });

  test("a number binary64 cannot hold exactly is refused in SQL too", () => {
    const fn = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_number_text(",
      ),
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_json(",
      ),
    );
    expect(fn).toBeTruthy();
    expect(fn).toContain("v_text::numeric <> p_value");
    expect(fn).toContain("not exactly representable as an IEEE-754 double");
    expect(fn).toContain("overflows an IEEE-754 double");
  });

  test("SQL orders object keys the same way and narrows the same charset", () => {
    const fn = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_json(",
      ),
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_digest(",
      ),
    );
    expect(fn).toBeTruthy();
    expect(fn).toContain('ORDER BY key COLLATE "C"');
    expect(fn).toContain("'^[A-Za-z][A-Za-z0-9_]{0,63}$'");
    // Never `jsonb::text`: that is PostgreSQL's rendering of an
    // arbitrary-precision numeric, which is exactly what this replaced.
    expect(fn).not.toContain("p_value::text");
  });

  test("the digest is taken over canonical UTF-8 bytes, not over jsonb text", () => {
    const fn = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_canonical_digest(",
      ),
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_payload_string(",
      ),
    );
    expect(fn).toContain("plugin_data.csf_canonical_json(p_value)");
    expect(fn).toContain("'UTF8'");
    expect(fn).toContain("sha256");
  });

  const MIGRATION_APPEND = migration
    .slice(
      migration.lastIndexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_append_import_preview_rows(",
      ),
    )
    .slice(0, 20000);

  test("the derivation mirrors buildCsfRowCommitPayload rather than trusting a caller", () => {
    const fn = migration
      .slice(
        migration.indexOf(
          "CREATE OR REPLACE FUNCTION plugin_data.csf_derive_row_commit_payload(",
        ),
      )
      .slice(0, 9000);
    expect(fn).toContain("'version', 'csf-commit-payload/v1'");
    // An application's canonical pair is unconditionally null, in SQL, regardless
    // of what the record carries.
    expect(fn).toContain(
      "IF p_source_type = 'application_responses' THEN\n    v_school := NULL;",
    );
    // Claimed totals ride along; the operative totals stay null.
    expect(fn).toContain("'listIPoints', NULL");
    expect(fn).toContain("'claimedTotals', pg_catalog.jsonb_build_object(");
    // Bonus weight is published policy, never a course name.
    expect(fn).toContain("'isBonus', false");
  });

  test("superseded is derived from proven lineage, never selected", () => {
    const fn = MIGRATION_APPEND;
    // Not in the accepted-status list...
    expect(fn).toContain(
      "'pending', 'ambiguous', 'conflict', 'duplicate', 'error', 'skipped'",
    );
    expect(fn).toContain("`superseded` is NOT in that list");
    // ...held as pending until proved...
    expect(fn).toContain("v_status := 'pending';");
    // ...and promoted only on exact lineage plus identical canonical evidence.
    expect(fn).toContain(
      "v_parent.import_status = ANY (c_committed_parent_status)",
    );
    expect(fn).toContain("v_parent.row_hash IS NOT DISTINCT FROM v_digest");
    expect(fn).toContain(
      "v_parent.normalized_data IS NOT DISTINCT FROM v_normalized",
    );
    expect(fn).toContain(
      "c_committed_parent_status constant text[] := ARRAY['created', 'updated', 'superseded']",
    );
    // The parent is cleared per row, so one row's ancestry cannot leak into the next.
    expect(fn).toContain("v_parent := NULL;");
  });

  test("the append RPC derives the payload and refuses a caller-stated one", () => {
    const fn = MIGRATION_APPEND;
    expect(fn).toContain("IF v_normalized ? 'commitPayload' THEN");
    expect(fn).toContain("may not state its own commit payload");
    expect(fn).toContain(
      "v_payload := plugin_data.csf_derive_row_commit_payload(",
    );
    expect(fn).toContain(
      "v_digest := plugin_data.csf_canonical_digest(v_record);",
    );
    // A caller digest that disagrees with the derived one is refused, not trusted.
    expect(fn).toContain("does not match the record it carries");
    // Absent or unknown contract version fails closed.
    expect(fn).toContain("'csf-normalized-import/v1'");
  });
});
