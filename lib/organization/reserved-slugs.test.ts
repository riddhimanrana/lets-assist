import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RESERVED_ORGANIZATION_SLUGS,
  isReservedOrganizationSlug,
  normalizeOrganizationSlugForReservedCheck,
} from "./reserved-slugs";

/**
 * `create` and `join` are static routes under `app/organization`
 * (`app/organization/create`, `app/organization/join`). An organization
 * claiming either username as its `/organization/<username>` path segment
 * would be unreachable at its own profile URL and would shadow -- or be
 * shadowed by -- the platform route. This matrix mirrors the adversarial
 * shape of `app/signup/request-origin.test.ts`: every case, whitespace, and
 * Unicode-compatibility spelling of a reserved slug must still resolve to
 * "reserved", while ordinary usernames -- including ones that merely
 * contain a reserved word -- must not be caught by the check.
 */
describe("RESERVED_ORGANIZATION_SLUGS", () => {
  test("covers exactly the static/special child routes of app/organization", () => {
    // `[id]` is the only dynamic segment; every other child directory is a
    // platform route that a username would collide with.
    expect([...RESERVED_ORGANIZATION_SLUGS].sort()).toEqual(["create", "join"]);
  });
});

describe("isReservedOrganizationSlug", () => {
  test("rejects the exact reserved spellings", () => {
    expect(isReservedOrganizationSlug("create")).toBe(true);
    expect(isReservedOrganizationSlug("join")).toBe(true);
  });

  test("rejects case variations", () => {
    for (const value of [
      "Create",
      "CREATE",
      "cReAtE",
      "Join",
      "JOIN",
      "jOiN",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(true);
    }
  });

  test("rejects surrounding whitespace", () => {
    for (const value of [
      " create",
      "create ",
      "  create  ",
      "\tcreate\n",
      " Join ",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(true);
    }
  });

  test("rejects Unicode compatibility variants that normalize to a reserved word", () => {
    // Full-width Latin letters (U+FF43 etc.) NFKC-normalize to ASCII.
    expect(isReservedOrganizationSlug("ｃｒｅａｔｅ")).toBe(true);
    expect(isReservedOrganizationSlug("ｊｏｉｎ")).toBe(true);
    // A single ligature codepoint (U+FB01 "fi") NFKC-decomposes to "fi".
    expect(isReservedOrganizationSlug("ﬁ")).toBe(false); // sanity: "fi" alone isn't reserved
  });

  test("rejects combined case, whitespace, and Unicode-compatibility tricks", () => {
    expect(isReservedOrganizationSlug(" Ｃreate ")).toBe(true); // fullwidth "C" + "reate", padded
  });

  test("accepts ordinary usernames unaffected by the reserved set", () => {
    for (const value of [
      "lets-assist",
      "acme-nonprofit",
      "dvhs",
      "my_org.2026",
      "a",
      "",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(false);
    }
  });

  test("does not treat a reserved word as a substring match", () => {
    // These merely contain "create"/"join" and must remain available.
    for (const value of [
      "creators",
      "createorg",
      "the-creators-collective",
      "rejoin",
      "joint-venture",
      "enjoin",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(false);
    }
  });

  test("null-ish and non-string-shaped edge cases never throw", () => {
    expect(() => isReservedOrganizationSlug("")).not.toThrow();
    expect(isReservedOrganizationSlug("")).toBe(false);
  });
});

describe("normalizeOrganizationSlugForReservedCheck", () => {
  test("trims, lowercases, and NFKC-normalizes", () => {
    expect(normalizeOrganizationSlugForReservedCheck("  Create  ")).toBe(
      "create",
    );
    expect(normalizeOrganizationSlugForReservedCheck("ＣＲＥＡＴＥ")).toBe(
      "create",
    );
  });

  test("is idempotent", () => {
    const once = normalizeOrganizationSlugForReservedCheck(" Join ");
    expect(normalizeOrganizationSlugForReservedCheck(once)).toBe(once);
  });
});

/**
 * The database enforces the same reserved set through
 * `organizations_username_not_reserved_check`, because RLS lets a trusted
 * member INSERT and an org admin UPDATE `organizations.username` straight
 * through the Data API without passing a Server Action. That constraint is
 * only a real backstop if its normalization is *identical* to this module's,
 * not merely similar:
 *
 * - a code point `String.prototype.trim()` strips but the constraint keeps
 *   is a bypass -- the Server Action refuses the padded reserved word while
 *   a direct write stores it, and the stored username then loses to the
 *   static route;
 * - a code point the constraint strips but `trim()` keeps is a false
 *   rejection of a legitimate username that the application layer allowed.
 *
 * ECMAScript defines `trim()` as stripping the union of WhiteSpace and
 * LineTerminator. These are those code points, written out so all three
 * artifacts -- this module, the migration, and the pgTAP suite -- are
 * anchored to one explicit list instead of three that can drift apart.
 */
const ECMASCRIPT_TRIM_CODE_POINTS = [
  0x0009, // CHARACTER TABULATION
  0x000a, // LINE FEED
  0x000b, // LINE TABULATION
  0x000c, // FORM FEED
  0x000d, // CARRIAGE RETURN
  0x0020, // SPACE
  0x00a0, // NO-BREAK SPACE
  0x1680, // OGHAM SPACE MARK
  0x2000, // EN QUAD
  0x2001, // EM QUAD
  0x2002, // EN SPACE
  0x2003, // EM SPACE
  0x2004, // THREE-PER-EM SPACE
  0x2005, // FOUR-PER-EM SPACE
  0x2006, // SIX-PER-EM SPACE
  0x2007, // FIGURE SPACE
  0x2008, // PUNCTUATION SPACE
  0x2009, // THIN SPACE
  0x200a, // HAIR SPACE
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
  0x202f, // NARROW NO-BREAK SPACE
  0x205f, // MEDIUM MATHEMATICAL SPACE
  0x3000, // IDEOGRAPHIC SPACE
  0xfeff, // ZERO WIDTH NO-BREAK SPACE
] as const;

/**
 * Format-control and zero-width code points that look like padding but are
 * neither WhiteSpace nor LineTerminator, so neither side may strip them.
 */
const NON_TRIM_CODE_POINTS = [
  0x00ad, // SOFT HYPHEN
  0x180e, // MONGOLIAN VOWEL SEPARATOR
  0x200b, // ZERO WIDTH SPACE
  0x200e, // LEFT-TO-RIGHT MARK
  0x2060, // WORD JOINER
] as const;

const RESERVED_WORDS = ["create", "join"] as const;

const hex = (code: number) => code.toString(16);
const char = (code: number) => String.fromCodePoint(code);

describe("normalization parity with the database constraint", () => {
  test("String.prototype.trim strips exactly the 25 code points the constraint lists", () => {
    // Exhaustive over the Basic Multilingual Plane, skipping surrogates.
    // Nothing outside the BMP is WhiteSpace or LineTerminator.
    const stripped: number[] = [];
    for (let code = 1; code < 0x10000; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      if (char(code).trim() === "") stripped.push(code);
    }
    expect(stripped.map(hex)).toEqual(
      [...ECMASCRIPT_TRIM_CODE_POINTS].map(hex),
    );
  });

  test("padding a reserved word is caught for exactly those 25 code points, BMP-wide", () => {
    // This is the shape the SQL side asserts too: the set of padding code
    // points that make `<cp>create<cp>` resolve to the reserved word must
    // be identical on both sides. Anything extra here that the constraint
    // lacks is a bypass; anything the constraint has that is missing here
    // is a false rejection.
    for (const word of RESERVED_WORDS) {
      const caught: number[] = [];
      for (let code = 1; code < 0x10000; code += 1) {
        if (code >= 0xd800 && code <= 0xdfff) continue;
        const padding = char(code);
        if (isReservedOrganizationSlug(`${padding}${word}${padding}`)) {
          caught.push(code);
        }
      }
      expect(caught.map(hex)).toEqual(
        [...ECMASCRIPT_TRIM_CODE_POINTS].map(hex),
      );
    }
  });

  test("every trimmed code point, in every edge placement, around every reserved word", () => {
    for (const code of ECMASCRIPT_TRIM_CODE_POINTS) {
      const padding = char(code);
      for (const word of RESERVED_WORDS) {
        const cases = {
          leading: `${padding}${word}`,
          trailing: `${word}${padding}`,
          both: `${padding}${word}${padding}`,
        };
        for (const [placement, value] of Object.entries(cases)) {
          expect({
            code: hex(code),
            word,
            placement,
            reserved: isReservedOrganizationSlug(value),
          }).toEqual({ code: hex(code), word, placement, reserved: true });
        }
      }
    }
  });

  test("the same code points in the interior of a username are not stripped", () => {
    for (const code of ECMASCRIPT_TRIM_CODE_POINTS) {
      expect({
        code: hex(code),
        reserved: isReservedOrganizationSlug(`cre${char(code)}ate`),
      }).toEqual({ code: hex(code), reserved: false });
    }
  });

  test("near-miss padding survives, so the padded value is not the reserved word", () => {
    for (const code of NON_TRIM_CODE_POINTS) {
      const padding = char(code);
      for (const word of RESERVED_WORDS) {
        for (const value of [
          `${padding}${word}`,
          `${word}${padding}`,
          `${padding}${word}${padding}`,
        ]) {
          expect({
            code: hex(code),
            word,
            reserved: isReservedOrganizationSlug(value),
          }).toEqual({ code: hex(code), word, reserved: false });
        }
      }
    }
  });

  test("one trimmed edge and one surviving near-miss edge is still not reserved", () => {
    // The case an over-eager trim gets wrong: the trimmed side goes away,
    // the zero-width side stays, so the result is a different string.
    for (const code of ECMASCRIPT_TRIM_CODE_POINTS) {
      for (const word of RESERVED_WORDS) {
        expect({
          code: hex(code),
          word,
          reserved: isReservedOrganizationSlug(
            `${char(code)}${word}${char(0x200b)}`,
          ),
        }).toEqual({ code: hex(code), word, reserved: false });
      }
    }
  });

  /**
   * The exhaustive BMP scan above proves parity only for U+0001..U+FFFF.
   * Astral code points (U+10000 and above) are outside that range and their
   * Unicode properties -- including NFKC compatibility decompositions -- can
   * differ between Node's bundled ICU version and PostgreSQL's Unicode build.
   * A future Unicode version could assign a new astral code point whose NFKC
   * form is an ASCII word, creating a gap that neither the BMP scan nor the
   * pgTAP BMP scan would catch. This block documents the current state with
   * spot checks; it is NOT a completeness guarantee for astral code points.
   *
   * The Node ICU / PostgreSQL Unicode skew arises because:
   *   - Node bundles a specific ICU data snapshot (compile-time pinned).
   *   - PostgreSQL uses its own Unicode table, also compile-time pinned.
   *   - When either is updated to a newer Unicode version, previously
   *     unassigned code points may acquire compatibility decompositions.
   *   - The BMP scan is exhaustive and self-consistent within one runtime,
   *     but it cannot detect cross-runtime divergence for astral points.
   *
   * U+1CCDA and U+1CCE3 are currently unassigned astral code points with no
   * NFKC compatibility decomposition under Node's current ICU build. They do
   * not trim (String.prototype.trim does not strip any astral code point),
   * and padding a reserved word with them is not caught by the check. These
   * properties are stable only until a Unicode version assigns them.
   *
   * The pgTAP BMP scan in organization_username_reserved_slugs.test.sql
   * covers U+0001..U+FFFF with the same caveats; the comment there mirrors
   * this documentation.
   */
  test("astral spot checks -- BMP parity proof does not cover > U+FFFF (Node ICU vs PG Unicode skew)", () => {
    const astralSpots = [
      0x1ccda, // currently unassigned; no NFKC decomposition under Node ICU
      0x1cce3, // currently unassigned; no NFKC decomposition under Node ICU
    ];

    for (const code of astralSpots) {
      const ch = String.fromCodePoint(code);

      // String.prototype.trim does not strip any astral code point.
      expect({ code: hex(code), trimmed: ch.trim() === "" }).toEqual({
        code: hex(code),
        trimmed: false,
      });

      // Under current Node ICU, these do not NFKC-normalize to a reserved word.
      for (const word of RESERVED_WORDS) {
        expect({
          code: hex(code),
          word,
          reserved: isReservedOrganizationSlug(`${ch}${word}${ch}`),
        }).toEqual({ code: hex(code), word, reserved: false });
      }
    }
  });
});

/**
 * The parity proof above is only worth anything if all three artifacts are
 * anchored to the same list. The migration's regular expression character
 * class and the pgTAP suite's code point table are both parsed here and
 * compared against `ECMASCRIPT_TRIM_CODE_POINTS`, so adding a code point to
 * one place without the others fails here rather than silently opening a
 * one-sided gap that only shows up as a live bypass.
 */
describe("migration and pgTAP suite agree on the trim set", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");

  test("the migration's character class expands to exactly these code points", () => {
    const migration = read(
      "supabase/migrations/20260812100000_organization_username_reserved_slugs.sql",
    );

    // `'^[<class>]+'` -- the leading-edge half of the constraint's regex.
    const match = migration.match(/'\^\[((?:\\u[0-9a-f]{4}|-)+)\]\+'/u);
    expect(match).not.toBeNull();

    const tokens = (match as RegExpMatchArray)[1].match(
      /\\u[0-9a-f]{4}|-/gu,
    ) as string[];

    const expanded: number[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "-") {
        // A range: the previous token is its start, the next its end.
        const from = parseInt(tokens[index - 1].slice(2), 16);
        const to = parseInt(tokens[index + 1].slice(2), 16);
        for (let code = from + 1; code <= to; code += 1) expanded.push(code);
        index += 1;
        continue;
      }
      expanded.push(parseInt(token.slice(2), 16));
    }

    expect(expanded.map(hex)).toEqual(
      [...ECMASCRIPT_TRIM_CODE_POINTS].map(hex),
    );

    // Both halves of the alternation use the identical class.
    const classes = migration.match(/\[(?:\\u[0-9a-f]{4}|-)+\]/gu) as string[];
    expect(classes).toHaveLength(2);
    expect(classes[0]).toBe(classes[1]);
  });

  test("the pgTAP suite's code point table lists exactly these code points", () => {
    const suite = read(
      "supabase/tests/database/organization_username_reserved_slugs.test.sql",
    );

    const start = suite.indexOf(
      "INSERT INTO ecma_trim_codepoint (code, code_label) VALUES",
    );
    expect(start).toBeGreaterThan(-1);
    const block = suite.slice(start, suite.indexOf(";", start));
    const codes = [...block.matchAll(/\((\d+), '/gu)].map((m) =>
      Number.parseInt(m[1], 10),
    );

    expect(codes.map(hex)).toEqual([...ECMASCRIPT_TRIM_CODE_POINTS].map(hex));
  });

  test("the pgTAP suite's near-miss table lists exactly the near-miss code points", () => {
    const suite = read(
      "supabase/tests/database/organization_username_reserved_slugs.test.sql",
    );

    const start = suite.indexOf(
      "INSERT INTO non_trim_codepoint (code, code_label) VALUES",
    );
    expect(start).toBeGreaterThan(-1);
    const block = suite.slice(start, suite.indexOf(";", start));
    const codes = [...block.matchAll(/\((\d+), '/gu)].map((m) =>
      Number.parseInt(m[1], 10),
    );

    expect(codes.map(hex)).toEqual([...NON_TRIM_CODE_POINTS].map(hex));
  });

  test("the migration reserves exactly the slugs this module reserves", () => {
    const migration = read(
      "supabase/migrations/20260812100000_organization_username_reserved_slugs.sql",
    );
    const match = migration.match(/<> ALL \(ARRAY\[([^\]]+)\]\)/u);
    expect(match).not.toBeNull();

    const slugs = [
      ...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/gu),
    ].map((m) => m[1]);

    expect(slugs.sort()).toEqual([...RESERVED_ORGANIZATION_SLUGS].sort());
  });
});
