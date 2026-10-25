import { describe, expect, test } from "bun:test";

import {
  certificateExportType,
  encodeCsvField,
  parseCsv,
  serializeCsv,
} from "./csv";

describe("fields are exported safe for spreadsheets", () => {
  const formulas = [
    "=SUM(A1:A2)",
    "+1 555 0100",
    "-2+3",
    "@handle",
    "  =indented",
    "\t=tabbed",
    "\r\n=after a line break",
    "\u0000=after a null",
    " \u0001\u001f\u007f@after controls",
    '=HYPERLINK("http://example.test","x")',
  ];

  test("a value a spreadsheet would run gets a leading apostrophe and nothing else changes", () => {
    for (const value of formulas) {
      expect(encodeCsvField(value)).toBe(`'${value}`);
      const [[cell]] = parseCsv(serializeCsv([[value]]));
      expect(cell).toBe(`'${value}`);
      expect(/^[\s\p{Cc}]*[=+\-@]/u.test(cell)).toBe(false);
    }
  });

  test("the serialized text never opens a field with a formula character", () => {
    const text = serializeCsv([formulas, ["plain", "=again"]]);

    expect(text).not.toMatch(/(^|,|\n)"[\s\p{Cc}]*[=+\-@]/u);
    expect(text.startsWith(`"'=SUM(A1:A2)","'+1 555 0100"`)).toBe(true);
  });

  test("a value that already starts with an apostrophe stays distinguishable from a guarded one", () => {
    expect(encodeCsvField("=A1")).toBe("'=A1");
    expect(encodeCsvField("'=A1")).toBe("''=A1");
    expect(encodeCsvField("''=A1")).toBe("'''=A1");
    expect(encodeCsvField("'quoted")).toBe("''quoted");
    expect(encodeCsvField("  'indented")).toBe("'  'indented");

    const sources = ["=A1", "'=A1", "''=A1", "A1", "'A1", " =A1", " '=A1"];
    expect(new Set(sources.map(encodeCsvField)).size).toBe(sources.length);
  });

  test("apostrophes and formula characters inside a value are left alone", () => {
    for (const value of ["O'Neil", "a=b", "x - y", "name@example.test", ""]) {
      expect(encodeCsvField(value)).toBe(value);
    }
  });
});

describe("the exported certificate type", () => {
  test("a missing type and the legacy verified name export as platform", () => {
    for (const stored of [null, undefined, "", "platform", "verified"]) {
      expect(certificateExportType(stored)).toBe("platform");
    }
  });

  test("self-reported and unknown types never export as platform", () => {
    for (const stored of [
      "self-reported",
      "official",
      "Verified",
      "PLATFORM",
    ]) {
      expect(certificateExportType(stored)).toBe("self-reported");
    }
  });
});

describe("certificate CSV round trip", () => {
  const awkward = [
    "plain",
    "",
    "   padded   ",
    "Lee, Jordan",
    'Jordan "JJ" Lee',
    '"quoted from the start"',
    'ends with a quote"',
    '""',
    'a "b", c',
    "line one\nline two",
    "line one\r\nline two",
    "lone\rcarriage return",
    'all, of "it"\r\ntogether, "again"',
    '"lee, jordan"@example.test',
    "O'Neil",
    "mid = sign, mid - dash, mid @ at",
    "﻿not a leading mark",
  ];

  test("every ordinary awkward field reads back exactly as written", () => {
    for (const field of awkward) {
      expect(encodeCsvField(field)).toBe(field);
      expect(parseCsv(serializeCsv([["id", field, "after"]]))).toEqual([
        ["id", field, "after"],
      ]);
    }
  });

  test("several records of awkward fields keep their boundaries", () => {
    const rows = [
      ["Certificate ID", "Volunteer Name", "Volunteer Email"],
      ["1", 'Lee, Jordan "JJ"\nJunior', '"lee, jordan"@example.test'],
      ["2", "", "plain@example.test"],
      ["3", "line one\r\nline two", ""],
    ];

    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
    expect(
      parseCsv(awkward.map((field) => serializeCsv([[field]])).join("\n")),
    ).toEqual(awkward.map((field) => [field]));
  });

  test("a guarded field with commas, quotes, and line breaks reads back as its encoding", () => {
    const value = '=CONCAT("a", "b")\r\n+more';

    expect(parseCsv(serializeCsv([["id", value, "after"]]))).toEqual([
      ["id", `'${value}`, "after"],
    ]);
  });

  test("quotes are doubled and records end with CRLF", () => {
    expect(
      serializeCsv([
        ["a", 'b "c"'],
        ["d,e", "f\ng"],
      ]),
    ).toBe('"a","b ""c"""\r\n"d,e","f\ng"');
  });
});

describe("reading CSV written elsewhere", () => {
  test("LF, CRLF, and CR record endings, a byte order mark, and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n\r\n"c",d\n\ne,"f"\rg,h\n')).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\r\n")).toEqual([]);
  });

  test("unquoted fields are not trimmed and empty fields are kept", () => {
    expect(parseCsv(' a , "b" ,,\n,')).toEqual([
      [" a ", ' "b" ', "", ""],
      ["", ""],
    ]);
    expect(parseCsv('""')).toEqual([[""]]);
  });

  test("an export made before quotes were escaped keeps its inner quotes", () => {
    expect(
      parseCsv('"id","Jordan "JJ" Lee","Friends, Inc."\n"id2","plain","x"'),
    ).toEqual([
      ["id", 'Jordan "JJ" Lee', "Friends, Inc."],
      ["id2", "plain", "x"],
    ]);
  });

  test("a quoted field left open runs to the end of the text", () => {
    expect(parseCsv('a,"open\nstill open')).toEqual([
      ["a", "open\nstill open"],
    ]);
  });
});
