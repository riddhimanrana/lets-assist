import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCsv, serializeCsv } from "@/lib/certificates/csv";
import { certificateVerification } from "@/lib/certificates/verification";
import { certificateToDashboardExport } from "@/lib/certificates/dashboard-export";

import {
  parseCertificateCsv,
  parseStrictHours,
  summarizeVerifiedHours,
  validateCertificateRow,
  verifyCertificateId,
} from "./csv-verification-logic";
import type { CertificateRow } from "./csv-verification-types";

type StoredCertificate = Parameters<typeof certificateVerification>[0] & {
  hours?: number | null;
  check_in_method?: string | null;
};

const CERTIFICATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_EMAIL = "account@example.test";

function storedCertificate(
  overrides: Partial<StoredCertificate> = {},
): StoredCertificate {
  return {
    id: CERTIFICATE_ID,
    project_id: "fictional-project",
    project_title: "Fictional cleanup",
    project_location: "Fictional park",
    organization_name: "Fictional organization",
    creator_id: "fictional-creator",
    creator_name: "Fictional supervisor",
    is_certified: true,
    event_start: "2026-10-06T16:00:00Z",
    event_end: "2026-10-06T17:15:00Z",
    credited_minutes: 61,
    volunteer_name: "Fictional recipient",
    volunteer_email: "recipient@example.test",
    issued_at: "2026-10-07T00:00:00Z",
    type: "platform",
    check_in_method: "manual",
    ...overrides,
  };
}

/**
 * The cells the dashboard export writes for a certificate, in column order.
 * Uses the dashboard's actual formatter. The date cells are not compared with
 * the record, but must still be accepted by the upload parser.
 */
function exportedCells(certificate: StoredCertificate): string[] {
  const row = certificateToDashboardExport(certificate, ACCOUNT_EMAIL);
  return [
    row.id,
    row.projectTitle,
    row.organizationName,
    row.supervisorContact,
    row.certificationStatus,
    row.type,
    row.date + " " + row.startTime,
    row.endDate + " " + row.endTime,
    row.duration,
    row.location,
    row.checkInMethod,
    row.volunteerName,
    row.volunteerEmail,
    row.issuedDate,
  ];
}

/** Writes the cells as the export does, then reads them as the checker does. */
function uploadedRow(cells: string[]): CertificateRow {
  const records = parseCsv(serializeCsv([cells]));
  expect(records).toHaveLength(1);
  return validateCertificateRow(records[0], []);
}

/** Quoted CSV with no spreadsheet guard: a hand-edited or older file. */
function rawCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/gu, '""')}"`).join(","))
    .join("\r\n");
}

function rawRow(cells: string[]): CertificateRow {
  return validateCertificateRow(parseCsv(rawCsv([cells]))[0], []);
}

const EXPORT_HEADERS = [
  "Certificate ID",
  "Project Title",
  "Organization Name",
  "Project Organizer Name",
  "Certification Status",
  "Certificate Type",
  "Event Start Date",
  "Event End Date",
  "Duration",
  "Location",
  "Check In Method",
  "Volunteer Name",
  "Volunteer Email",
  "Issued Date",
];

const originalFetch = globalThis.fetch;
let requestedUrls: string[] = [];

function respondWith(reply: () => Response | Promise<Response>) {
  requestedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input));
    return reply();
  }) as typeof fetch;
}

/** The lookup answers with what the verification route returns for a record. */
function recordOnFile(certificate: StoredCertificate) {
  respondWith(() => Response.json(certificateVerification(certificate)));
}

async function verify(row: CertificateRow) {
  const verified = await verifyCertificateId(row.certificateId, row);
  if (!verified) throw new Error("Expected a verification outcome");
  return verified;
}

function mismatchedFields(row: CertificateRow) {
  return Object.entries(row.verificationResult?.verification?.matches ?? {})
    .filter(([, matched]) => !matched)
    .map(([field]) => field);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("an unmodified dashboard export verifies", () => {
  test("61 credited minutes compare exactly with the exported decimal", async () => {
    const certificate = storedCertificate({ credited_minutes: 61 });
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(certificate);

    expect(row.duration).toBe("1.0166666666666666");
    expect(row.issues).toEqual([]);
    const verified = await verify(row);

    expect(mismatchedFields(verified)).toEqual([]);
    expect(verified.verificationStatus).toBe("verified");
    expect(verified.isVerified).toBe(true);
    expect(requestedUrls).toEqual([
      `/api/certificates/verify/${CERTIFICATE_ID}`,
    ]);
  });

  test("zero credited minutes verify as zero hours", async () => {
    const certificate = storedCertificate({ credited_minutes: 0 });
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(certificate);

    expect(row.duration).toBe("0");
    expect(row.valid).toBe(true);
    expect((await verify(row)).isVerified).toBe(true);
  });

  test("a legacy certificate without credited minutes verifies on its one-decimal hours", async () => {
    const certificate = storedCertificate({
      credited_minutes: null,
      hours: 1.3,
    });
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(certificate);

    expect(row.duration).toBe("1.3");
    expect((await verify(row)).isVerified).toBe(true);
  });

  test("a spreadsheet's 15-digit rounding of the decimal still verifies", async () => {
    const certificate = storedCertificate({ credited_minutes: 61 });
    const cells = exportedCells(certificate);
    cells[8] = "1.01666666666667";
    recordOnFile(certificate);

    expect((await verify(uploadedRow(cells))).isVerified).toBe(true);
  });

  test("the export's placeholders for empty record fields verify", async () => {
    const certificate = storedCertificate({
      organization_name: null,
      project_location: null,
      volunteer_name: null,
      is_certified: null,
    });
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(certificate);

    expect(row).toMatchObject({
      organizationName: "Fictional supervisor",
      location: "Unknown Location",
      volunteerName: "Unknown Volunteer",
      certificationStatus: "Participated",
    });
    expect((await verify(row)).isVerified).toBe(true);
  });

  test("a record with neither organization nor organizer verifies on both placeholders", async () => {
    const certificate = storedCertificate({
      organization_name: null,
      creator_name: null,
    });
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(certificate);

    expect(row).toMatchObject({
      organizationName: "Unknown Organization",
      organizerName: "Unknown Supervisor",
    });
    expect((await verify(row)).isVerified).toBe(true);
  });

  test("the placeholders compared here are the ones the export writes", () => {
    const exporter = readFileSync(
      join(process.cwd(), "app/dashboard/_components/ExportSection.tsx"),
      "utf8",
    );
    const formatter = readFileSync(
      join(process.cwd(), "lib/certificates/dashboard-export.ts"),
      "utf8",
    );
    for (const contract of [
      'cert.organization_name || cert.creator_name || "Unknown Organization"',
      'cert.creator_name || "Unknown Supervisor"',
      'cert.volunteer_name || "Unknown Volunteer"',
      'cert.project_location || "Unknown Location"',
      '"Unknown Project"',
      "certificateHours(cert, () =>",
      'certificateExportType(cert.type) === "platform"',
    ]) {
      expect(formatter).toContain(contract);
    }
    expect(exporter).toContain("certificateToDashboardExport(cert, userEmail)");
    expect(exporter).toContain("serializeCsv([headers, ...rows])");
    // Fields are never wrapped in quotes by hand again.
    expect(exporter).not.toMatch(/`"\$\{field\}"`/u);
  });
});

describe("punctuation in identifying fields survives export and upload", () => {
  const punctuated = {
    project_title: 'Park "Clean, Green" day',
    organization_name: 'Friends of "The Park", Inc.',
    creator_name: 'O\'Neil, Sam "Sunny"',
    volunteer_name: 'Lee, Jordan "JJ"\nJunior',
    volunteer_email: '"lee, jordan"@example.test',
    project_location: "Pier 9,\r\nNorth Dock",
  };

  test("commas, quotes, and line breaks read back exactly and verify", async () => {
    const certificate = storedCertificate(punctuated);
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(certificate);

    expect(row).toMatchObject({
      projectTitle: punctuated.project_title,
      organizationName: punctuated.organization_name,
      organizerName: punctuated.creator_name,
      volunteerName: punctuated.volunteer_name,
      volunteerEmail: punctuated.volunteer_email,
      location: punctuated.project_location,
    });
    const verified = await verify(row);

    expect(mismatchedFields(verified)).toEqual([]);
    expect(verified.isVerified).toBe(true);
  });

  test("a whole export with line breaks inside fields keeps one row per certificate", () => {
    const first = storedCertificate(punctuated);
    const second = storedCertificate({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const text = [
      serializeCsv([
        EXPORT_HEADERS,
        exportedCells(first),
        exportedCells(second),
      ]),
      rawCsv([["=== SUMMARY ==="], ["Total", "2"]]),
    ].join("\r\n");

    const parsed = parseCertificateCsv(text);
    if (!("rows" in parsed)) throw new Error(parsed.error);

    expect(parsed.rows.map((row) => row.certificateId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(parsed.rows.every((row) => row.valid)).toBe(true);
    expect(parsed.rows[0].volunteerName).toBe(punctuated.volunteer_name);
    expect(parsed.rows[0].location).toBe(punctuated.project_location);
  });

  test("summary marker text inside a certificate's fields does not hide later rows", () => {
    const marked = [
      storedCertificate({ project_title: "=== SUMMARY ===" }),
      storedCertificate({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        volunteer_name: "Sam ===SUMMARY=== Lee",
        project_location: "=== SUMMARY ===",
      }),
      storedCertificate({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    ];
    // Written without the spreadsheet guard, so the cells hold the bare text.
    const text = rawCsv([
      EXPORT_HEADERS,
      ...marked.map(exportedCells),
      ["=== SUMMARY ===", "", ""],
      [marked[0].id, "A summary line, not a certificate"],
    ]);

    const parsed = parseCertificateCsv(text);
    if (!("rows" in parsed)) throw new Error(parsed.error);

    expect(parsed.rows.map((row) => row.certificateId)).toEqual(
      marked.map((certificate) => certificate.id),
    );
    expect(parsed.rows[0].projectTitle).toBe("=== SUMMARY ===");
    expect(parsed.rows[1]).toMatchObject({
      volunteerName: "Sam ===SUMMARY=== Lee",
      location: "=== SUMMARY ===",
    });
  });

  test("a file without the certificate columns or without data is refused", () => {
    expect(parseCertificateCsv(serializeCsv([EXPORT_HEADERS]))).toEqual({
      error: "CSV file must contain at least a header row and one data row",
    });
    const wrong = parseCertificateCsv(
      serializeCsv([
        ["Name", "Hours"],
        ["Fictional recipient", "2"],
      ]),
    );
    expect("rows" in wrong).toBe(false);
  });

  const stripped: Array<{ name: string; column: number; field: string }> = [
    { name: "project title", column: 1, field: "title" },
    { name: "organization name", column: 2, field: "organization" },
    { name: "organizer name", column: 3, field: "organizer" },
    { name: "recipient name", column: 11, field: "recipientName" },
    { name: "recipient email", column: 12, field: "recipientEmail" },
  ];
  for (const { name, column, field } of stripped) {
    test(`a ${name} with its quotes removed no longer matches`, async () => {
      const certificate = storedCertificate(punctuated);
      const cells = exportedCells(certificate);
      cells[column] = cells[column].replace(/"/gu, "");
      recordOnFile(certificate);

      const verified = await verify(uploadedRow(cells));

      expect(verified.isVerified).toBe(false);
      expect(mismatchedFields(verified)).toEqual([field]);
    });
  }

  test("a name that differs only in case does not match", async () => {
    const certificate = storedCertificate();
    const cells = exportedCells(certificate);
    cells[11] = cells[11].toUpperCase();
    recordOnFile(certificate);

    expect(mismatchedFields(await verify(uploadedRow(cells)))).toEqual([
      "recipientName",
    ]);
  });

  test("an email that differs only in case or surrounding spaces matches", async () => {
    const certificate = storedCertificate();
    const cells = exportedCells(certificate);
    cells[12] = "  Recipient@Example.TEST ";
    recordOnFile(certificate);

    expect((await verify(uploadedRow(cells))).isVerified).toBe(true);
  });

  test("an export made before quotes were escaped still reads a quoted name back", async () => {
    const certificate = storedCertificate({
      volunteer_name: 'Jordan "JJ" Lee',
      organization_name: "Friends, Inc.",
    });
    const legacyLine = exportedCells(certificate)
      .map((cell) => `"${cell}"`)
      .join(",");
    const row = validateCertificateRow(parseCsv(legacyLine)[0], []);
    recordOnFile(certificate);

    expect(row.volunteerName).toBe('Jordan "JJ" Lee');
    expect((await verify(row)).isVerified).toBe(true);
  });
});

describe("formula-leading fields are exported guarded and still verify", () => {
  const formulaLeading = {
    project_title: '=HYPERLINK("http://example.test","Cleanup")',
    organization_name: "+1 Volunteers, Inc.",
    creator_name: "-Dash Supervisor",
    volunteer_name: "@fictional_recipient",
    volunteer_email: "=recipient@example.test",
    project_location: "\t=Pier 9",
  };
  const guardedColumns = [1, 2, 3, 9, 11, 12];

  test("the exported cells start with the protective apostrophe and the export verifies", async () => {
    const certificate = storedCertificate(formulaLeading);
    const text = serializeCsv([exportedCells(certificate)]);
    const cells = parseCsv(text)[0];
    recordOnFile(certificate);

    for (const column of guardedColumns) {
      expect(cells[column].startsWith("'")).toBe(true);
      expect(/^[\s\p{Cc}]*[=+\-@]/u.test(cells[column])).toBe(false);
    }
    expect(text).not.toMatch(/(^|,|\n)"[\s\p{Cc}]*[=+\-@]/u);
    expect(cells[1]).toBe(`'${formulaLeading.project_title}`);
    expect(cells[9]).toBe(`'${formulaLeading.project_location}`);

    const verified = await verify(validateCertificateRow(cells, []));

    expect(mismatchedFields(verified)).toEqual([]);
    expect(verified.isVerified).toBe(true);
  });

  test("whitespace and control characters before the formula are guarded the same way", async () => {
    const certificate = storedCertificate({
      project_title: "   =Leading spaces",
      volunteer_name: "\u0001\u001f+Control prefixed",
      project_location: " \r\n@Line break prefixed ",
    });
    const cells = parseCsv(serializeCsv([exportedCells(certificate)]))[0];
    recordOnFile(certificate);

    expect(cells[1]).toBe("'   =Leading spaces");
    expect(cells[11]).toBe("'\u0001\u001f+Control prefixed");
    expect(cells[9]).toBe("' \r\n@Line break prefixed ");
    expect((await verify(validateCertificateRow(cells, []))).isVerified).toBe(
      true,
    );
  });

  test("a cell with the protective apostrophe removed no longer matches", async () => {
    const certificate = storedCertificate(formulaLeading);
    recordOnFile(certificate);

    // Bare formula-leading cells, as a file edited by hand would hold them.
    const verified = await verify(rawRow(exportedCells(certificate)));

    expect(verified.isVerified).toBe(false);
    expect(mismatchedFields(verified)).toEqual([
      "title",
      "organization",
      "organizer",
      "recipientName",
      "recipientEmail",
      "location",
    ]);
  });

  test("a guarded title with its quotes removed no longer matches", async () => {
    const certificate = storedCertificate(formulaLeading);
    const cells = parseCsv(serializeCsv([exportedCells(certificate)]))[0];
    cells[1] = cells[1].replace(/"/gu, "");
    recordOnFile(certificate);

    expect(mismatchedFields(await verify(rawRow(cells)))).toEqual(["title"]);
  });

  test("a name that really starts with an apostrophe is not confused with a guarded formula", async () => {
    const literal = storedCertificate({ volunteer_name: "'=Formula" });
    const formula = storedCertificate({ volunteer_name: "=Formula" });
    const literalRow = uploadedRow(exportedCells(literal));
    const formulaRow = uploadedRow(exportedCells(formula));

    expect(literalRow.volunteerName).toBe("''=Formula");
    expect(formulaRow.volunteerName).toBe("'=Formula");

    recordOnFile(literal);
    expect((await verify(literalRow)).isVerified).toBe(true);
    expect(mismatchedFields(await verify(formulaRow))).toEqual([
      "recipientName",
    ]);

    recordOnFile(formula);
    expect((await verify(formulaRow)).isVerified).toBe(true);
    expect(mismatchedFields(await verify(literalRow))).toEqual([
      "recipientName",
    ]);
  });

  test("an ordinary apostrophe inside a name is exported and matched unchanged", async () => {
    const certificate = storedCertificate({ volunteer_name: "Sam O'Neil" });
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(certificate);

    expect(row.volunteerName).toBe("Sam O'Neil");
    expect((await verify(row)).isVerified).toBe(true);
  });

  test("a guarded email still ignores case but not its apostrophe", async () => {
    const certificate = storedCertificate({
      volunteer_email: "=Recipient@Example.test",
    });
    const cells = parseCsv(serializeCsv([exportedCells(certificate)]))[0];
    recordOnFile(certificate);

    cells[12] = "'=recipient@example.TEST";
    expect((await verify(rawRow(cells))).isVerified).toBe(true);

    cells[12] = "=recipient@example.test";
    expect(mismatchedFields(await verify(rawRow(cells)))).toEqual([
      "recipientEmail",
    ]);
  });
});

describe("a changed identifying field does not verify", () => {
  const alterations: Array<{
    name: string;
    column: number;
    value: string;
    field: string;
  }> = [
    {
      name: "project title",
      column: 1,
      value: "Another cleanup",
      field: "title",
    },
    {
      name: "organization name",
      column: 2,
      value: "Different fictional organization",
      field: "organization",
    },
    {
      name: "organizer name",
      column: 3,
      value: "Different supervisor",
      field: "organizer",
    },
    {
      name: "certification status",
      column: 4,
      value: "Participated",
      field: "status",
    },
    {
      name: "certificate type",
      column: 5,
      value: "self-reported",
      field: "type",
    },
    { name: "duration", column: 8, value: "1.1", field: "hours" },
    { name: "location", column: 9, value: "Another park", field: "location" },
    {
      name: "recipient name",
      column: 11,
      value: "Different fictional recipient",
      field: "recipientName",
    },
    {
      name: "recipient email",
      column: 12,
      value: "other@example.test",
      field: "recipientEmail",
    },
  ];

  for (const { name, column, value, field } of alterations) {
    test(`a changed ${name} fails on exactly that field`, async () => {
      const certificate = storedCertificate();
      const cells = exportedCells(certificate);
      cells[column] = value;
      const row = uploadedRow(cells);
      recordOnFile(certificate);

      expect(row.valid).toBe(true);
      const verified = await verify(row);

      expect(verified.isVerified).toBe(false);
      expect(verified.verificationStatus).toBe("verified");
      expect(mismatchedFields(verified)).toEqual([field]);
    });
  }

  test("a row whose certificate ID is not the record the lookup returned fails", async () => {
    const certificate = storedCertificate();
    const row = uploadedRow(exportedCells(certificate));
    recordOnFile(
      storedCertificate({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    );

    const verified = await verify(row);

    expect(verified.isVerified).toBe(false);
    expect(mismatchedFields(verified)).toEqual(["certificateId"]);
  });

  test("a difference inside the old tenth-of-an-hour tolerance fails", async () => {
    const certificate = storedCertificate({ credited_minutes: 61 });
    const cells = exportedCells(certificate);
    cells[8] = "1";
    recordOnFile(certificate);

    const verified = await verify(uploadedRow(cells));

    expect(verified.isVerified).toBe(false);
    expect(mismatchedFields(verified)).toEqual(["hours"]);
  });

  test("a record whose own hours are unusable never matches a row", async () => {
    const certificate = storedCertificate({
      credited_minutes: null,
      event_end: "invalid",
    });
    const cells = exportedCells(storedCertificate({ credited_minutes: 0 }));
    recordOnFile(certificate);

    const verified = await verify(uploadedRow(cells));

    expect(verified.isVerified).toBe(false);
    expect(mismatchedFields(verified)).toEqual(["hours"]);
  });

  for (const email of [ACCOUNT_EMAIL, "anyone@example.test", ""]) {
    test(`a record with no email cannot confirm "${email}"`, async () => {
      const certificate = storedCertificate({ volunteer_email: null });
      const cells = exportedCells(certificate);
      cells[12] = email;
      recordOnFile(certificate);

      const verified = await verify(uploadedRow(cells));

      expect(verified.isVerified).toBe(false);
      expect(verified.verificationStatus).toBe("verified");
      expect(mismatchedFields(verified)).toEqual(["recipientEmail"]);
    });
  }
});

describe("duration cells are read strictly", () => {
  for (const duration of [
    "1garbage",
    "1tampered",
    "1.5h",
    "-1",
    "+1",
    "Infinity",
    "NaN",
    "1e3",
    "0x10",
    ".5",
    "1.",
    "1 5",
  ]) {
    test(`"${duration}" is refused before any lookup`, () => {
      const cells = exportedCells(storedCertificate());
      cells[8] = duration;
      const row = uploadedRow(cells);

      expect(parseStrictHours(duration)).toBeNull();
      expect(row.valid).toBe(false);
      expect(row.issues).toEqual(["Invalid duration format"]);
    });
  }

  for (const duration of ["", "   "]) {
    test(`a missing duration ("${duration}") is refused`, () => {
      const cells = exportedCells(storedCertificate());
      cells[8] = duration;
      const row = uploadedRow(cells);

      expect(row.valid).toBe(false);
      expect(row.issues).toEqual(["Missing duration"]);
    });
  }

  test("plain non-negative decimals are accepted as written", () => {
    expect(parseStrictHours("0")).toBe(0);
    expect(parseStrictHours("2")).toBe(2);
    expect(parseStrictHours(" 1.5 ")).toBe(1.5);
    expect(parseStrictHours("1.0166666666666666")).toBe(61 / 60);
    expect(parseStrictHours(`1${"0".repeat(400)}`)).toBeNull();
  });
});

describe("the legacy verified type is an alias of platform", () => {
  test("a row tagged verified matches a platform record", async () => {
    const certificate = storedCertificate();
    const cells = exportedCells(certificate);
    cells[5] = "verified";
    recordOnFile(certificate);

    expect((await verify(uploadedRow(cells))).isVerified).toBe(true);
  });

  test("a record stored as verified exports as platform and verifies", async () => {
    const certificate = storedCertificate({ type: "verified" });
    const cells = exportedCells(certificate);
    recordOnFile(certificate);

    expect(cells[5]).toBe("platform");
    expect((await verify(uploadedRow(cells))).isVerified).toBe(true);
  });

  test("a self-reported record exports and verifies as self-reported", async () => {
    const certificate = storedCertificate({
      type: "self-reported",
      is_certified: false,
    });
    const cells = exportedCells(certificate);
    recordOnFile(certificate);

    expect(cells.slice(4, 6)).toEqual(["Participated", "self-reported"]);
    expect((await verify(uploadedRow(cells))).isVerified).toBe(true);
  });

  test("a record with an unknown type is exported conservatively and does not verify as platform", async () => {
    const certificate = storedCertificate({ type: "official" });
    const cells = exportedCells(certificate);
    recordOnFile(certificate);

    expect(cells[5]).toBe("self-reported");
    expect(mismatchedFields(await verify(uploadedRow(cells)))).toEqual([
      "type",
    ]);
  });

  test("a row with no type is read as platform", async () => {
    const certificate = storedCertificate();
    const cells = exportedCells(certificate);
    cells[5] = "";
    recordOnFile(certificate);

    expect((await verify(uploadedRow(cells))).isVerified).toBe(true);
  });

  test("an unknown type is refused as a format issue", () => {
    const cells = exportedCells(storedCertificate());
    cells[5] = "official";

    expect(uploadedRow(cells).valid).toBe(false);
  });
});

describe("a lookup that cannot answer is unavailable, not a missing certificate", () => {
  const row = () => uploadedRow(exportedCells(storedCertificate()));

  const outages: Array<{ name: string; reply: () => Response }> = [
    {
      name: "a 503 from the verification route",
      reply: () =>
        Response.json(
          { error: "temporarily unavailable", valid: false, retryable: true },
          { status: 503 },
        ),
    },
    {
      name: "a 500 with no existence claim",
      reply: () =>
        Response.json({ error: "internal", valid: false }, { status: 500 }),
    },
    {
      name: "a gateway error that is not JSON",
      reply: () => new Response("<html>Bad gateway</html>", { status: 502 }),
    },
    {
      name: "a rate limit",
      reply: () => Response.json({ error: "slow down" }, { status: 429 }),
    },
    {
      name: "a 500 from an older route that also says exists: false",
      reply: () =>
        Response.json(
          { error: "internal", valid: false, exists: false },
          { status: 500 },
        ),
    },
    {
      name: "a 503 that also says exists: false",
      reply: () =>
        Response.json(
          { error: "unavailable", valid: false, exists: false },
          { status: 503 },
        ),
    },
    {
      name: "a 504 timeout with an empty body",
      reply: () => new Response("", { status: 504 }),
    },
    {
      name: "a 200 whose body is not JSON",
      reply: () => new Response("{not json", { status: 200 }),
    },
    {
      name: "a 200 whose body is not an object",
      reply: () => Response.json("ok"),
    },
  ];

  for (const { name, reply } of outages) {
    test(`${name} is reported as unavailable and retryable`, async () => {
      respondWith(reply);

      const outcome = await verify(row());

      expect(outcome.verificationStatus).toBe("unavailable");
      expect(outcome.isVerified).toBe(false);
      expect(outcome.verificationResult).toMatchObject({
        valid: false,
        retryable: true,
      });
      expect(outcome.verificationResult).not.toHaveProperty("exists");
    });
  }

  test("a network failure is reported as unavailable and retryable", async () => {
    respondWith(() => {
      throw new TypeError("synthetic network failure");
    });
    const originalError = console.error;
    console.error = () => {};

    try {
      const outcome = await verify(row());

      expect(outcome.verificationStatus).toBe("unavailable");
      expect(outcome.verificationResult).toMatchObject({ retryable: true });
      expect(outcome.verificationResult).not.toHaveProperty("exists");
    } finally {
      console.error = originalError;
    }
  });

  test("an explicit 404 is the only answer reported as not found", async () => {
    respondWith(() =>
      Response.json(
        { error: "Certificate not found", valid: false, exists: false },
        { status: 404 },
      ),
    );

    const outcome = await verify(row());

    expect(outcome.verificationStatus).toBe("failed");
    expect(outcome.verificationResult).toEqual({
      valid: false,
      exists: false,
      error: "Certificate not found",
    });
  });

  test("a 404 that does not say the certificate is missing claims nothing about existence", async () => {
    respondWith(() => Response.json({ error: "No route" }, { status: 404 }));

    const outcome = await verify(row());

    expect(outcome.verificationStatus).toBe("failed");
    expect(outcome.verificationResult).toEqual({
      valid: false,
      error: "No route",
    });
  });

  test("a rejected request is a failure that claims nothing about existence", async () => {
    respondWith(() =>
      Response.json({ error: "Certificate ID is required" }, { status: 400 }),
    );

    const outcome = await verify(row());

    expect(outcome.verificationStatus).toBe("failed");
    expect(outcome.verificationResult).toEqual({
      valid: false,
      error: "Certificate ID is required",
    });
  });
});

describe("summary hours come from the certificate records", () => {
  test("only fully verified rows count, at the recorded hours, in their category", async () => {
    const official = storedCertificate({ credited_minutes: 61 });
    const platform = storedCertificate({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      credited_minutes: 90,
      is_certified: false,
    });
    const selfReported = storedCertificate({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      credited_minutes: 30,
      is_certified: false,
      type: "self-reported",
    });
    const tampered = storedCertificate({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      credited_minutes: 120,
    });

    const rows: CertificateRow[] = [];
    for (const certificate of [official, platform, selfReported]) {
      recordOnFile(certificate);
      rows.push(await verify(uploadedRow(exportedCells(certificate))));
    }
    const tamperedCells = exportedCells(tampered);
    tamperedCells[8] = "200";
    recordOnFile(tampered);
    rows.push(await verify(uploadedRow(tamperedCells)));
    respondWith(() => Response.json({ valid: false }, { status: 503 }));
    rows.push(await verify(uploadedRow(exportedCells(official))));

    expect(rows.map((row) => row.isVerified)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(summarizeVerifiedHours(rows)).toEqual({
      certifiedHours: 61 / 60,
      verifiedHours: 1.5,
      selfReportedHours: 0.5,
      totalHours: 61 / 60 + 1.5 + 0.5,
    });
  });

  test("a verified row is totalled from the record even if its cell is rewritten afterwards", async () => {
    const certificate = storedCertificate({ credited_minutes: 61 });
    recordOnFile(certificate);
    const verified = await verify(uploadedRow(exportedCells(certificate)));

    expect(
      summarizeVerifiedHours([{ ...verified, duration: "999garbage" }]),
    ).toMatchObject({ totalHours: 61 / 60, certifiedHours: 61 / 60 });
  });
});
