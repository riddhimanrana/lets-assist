import "server-only";

import * as XLSX from "xlsx";
import { isValidEmail } from "@/utils/email-parser";
import type {
  ContactImportFileType,
  ContactImportInvalidRow,
  ContactImportParseSummary,
  ContactImportParsedRow,
} from "@/types/contact-import";

const MAX_IMPORT_ROWS = 25_000;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

const EMAIL_HEADER_KEYS = [
  "email",
  "emailaddress",
  "emailid",
  "e-mail",
  "mail",
];

const NAME_HEADER_KEYS = [
  "name",
  "fullname",
  "full_name",
  "displayname",
  "display_name",
  "firstname",
  "first_name",
];

const PROFILE_FIELD_KEY_ALIASES: Record<string, string> = {
  name: "full_name",
  fullname: "full_name",
  full_name: "full_name",
  firstname: "first_name",
  first_name: "first_name",
  lastname: "last_name",
  last_name: "last_name",
  phone: "phone",
  phonenumber: "phone",
  phone_number: "phone",
  mobile: "phone",
  mobilenumber: "phone",
  mobile_number: "phone",
  cell: "phone",
  cellphone: "phone",
  cell_phone: "phone",
  avatar: "avatar_url",
  avatarurl: "avatar_url",
  avatar_url: "avatar_url",
  username: "username",
  company: "company",
  organization: "organization",
  notes: "notes",
  note: "notes",
};

export interface ParsedContactImportResult {
  fileType: ContactImportFileType;
  rows: ContactImportParsedRow[];
  invalidRows: ContactImportInvalidRow[];
  summary: ContactImportParseSummary;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function hasMatchingHeader(normalizedHeader: string, allowedKeys: string[]): boolean {
  return allowedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key));
}

function normalizeMetadataHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function normalizeProfileFieldKey(header: string): string | null {
  const normalized = normalizeMetadataHeader(header);
  if (!normalized) {
    return null;
  }

  return PROFILE_FIELD_KEY_ALIASES[normalized] ?? normalized;
}

function inferFileType(fileName: string): ContactImportFileType | null {
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith(".csv")) {
    return "csv";
  }

  if (lowerFileName.endsWith(".xlsx")) {
    return "xlsx";
  }

  if (lowerFileName.endsWith(".xls")) {
    return "xls";
  }

  return null;
}

function getIndexedRows(rawRows: unknown[]): Array<{ sourceRowNumber: number; cells: string[] }> {
  const indexedRows: Array<{ sourceRowNumber: number; cells: string[] }> = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i];

    if (!Array.isArray(rawRow)) {
      continue;
    }

    const cells = rawRow.map((cell) => String(cell ?? "").trim());
    const hasAnyValue = cells.some((cell) => cell.length > 0);

    if (!hasAnyValue) {
      continue;
    }

    indexedRows.push({
      sourceRowNumber: i + 1,
      cells,
    });
  }

  return indexedRows;
}

export async function parseContactImportFile(file: File): Promise<ParsedContactImportResult> {
  if (!file || !file.name) {
    throw new Error("Please choose a file to import.");
  }

  if (file.size === 0) {
    throw new Error("The uploaded file is empty.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File is too large. Maximum supported size is 15MB.");
  }

  const fileType = inferFileType(file.name);
  if (!fileType) {
    throw new Error("Unsupported file type. Please upload a CSV or Excel (.xlsx/.xls) file.");
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(fileBuffer, {
    type: "buffer",
    raw: false,
    dense: true,
    cellDates: false,
  });

  if (!workbook.SheetNames.length) {
    throw new Error("No worksheet found in the uploaded file.");
  }

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  if (!worksheet) {
    throw new Error("Unable to read the first worksheet from the uploaded file.");
  }

  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown[];

  const indexedRows = getIndexedRows(rawRows);

  if (indexedRows.length === 0) {
    return {
      fileType,
      rows: [],
      invalidRows: [],
      summary: {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        duplicateRows: 0,
        skippedEmptyRows: 0,
      },
    };
  }

  if (indexedRows.length > MAX_IMPORT_ROWS + 1) {
    throw new Error(`Too many rows. Maximum supported rows per import: ${MAX_IMPORT_ROWS}.`);
  }

  const firstDataCandidate = indexedRows[0];
  const normalizedFirstRow = firstDataCandidate.cells.map(normalizeHeader);
  const emailHeaderIndex = normalizedFirstRow.findIndex((header) =>
    hasMatchingHeader(header, EMAIL_HEADER_KEYS),
  );
  const nameHeaderIndex = normalizedFirstRow.findIndex((header) =>
    hasMatchingHeader(header, NAME_HEADER_KEYS),
  );

  const hasHeaderRow =
    emailHeaderIndex >= 0 ||
    normalizedFirstRow.some(
      (header) => header.includes("email") || header.includes("name") || header.includes("role"),
    );

  if (hasHeaderRow && emailHeaderIndex < 0) {
    throw new Error(
      "Could not find an email column. Add a header like 'email' or 'email address'.",
    );
  }

  const emailColumnIndex = hasHeaderRow ? emailHeaderIndex : 0;
  const fullNameColumnIndex = hasHeaderRow
    ? nameHeaderIndex
    : firstDataCandidate.cells.length > 1
      ? 1
      : -1;

  const rowStartIndex = hasHeaderRow ? 1 : 0;
  const validRows: ContactImportParsedRow[] = [];
  const invalidRows: ContactImportInvalidRow[] = [];
  const seenEmails = new Set<string>();

  let duplicateRows = 0;
  let skippedEmptyRows = 0;

  for (let i = rowStartIndex; i < indexedRows.length; i++) {
    const row = indexedRows[i];
    const rawEmail = row.cells[emailColumnIndex]?.trim() ?? "";
    const normalizedEmail = rawEmail.toLowerCase();

    if (!rawEmail) {
      const isEntireRowEmpty = row.cells.every((cell) => cell.trim().length === 0);

      if (isEntireRowEmpty) {
        skippedEmptyRows++;
        continue;
      }

      invalidRows.push({
        rowNumber: row.sourceRowNumber,
        email: null,
        reason: "Missing email",
      });
      continue;
    }

    if (!isValidEmail(normalizedEmail)) {
      invalidRows.push({
        rowNumber: row.sourceRowNumber,
        email: normalizedEmail,
        reason: "Invalid email format",
      });
      continue;
    }

    if (seenEmails.has(normalizedEmail)) {
      duplicateRows++;
      invalidRows.push({
        rowNumber: row.sourceRowNumber,
        email: normalizedEmail,
        reason: "Duplicate email in uploaded file",
      });
      continue;
    }

    seenEmails.add(normalizedEmail);

    const fullName =
      fullNameColumnIndex >= 0 ? row.cells[fullNameColumnIndex]?.trim() || null : null;

    const profileData: Record<string, string> = {};

    if (hasHeaderRow) {
      for (let columnIndex = 0; columnIndex < row.cells.length; columnIndex++) {
        if (columnIndex === emailColumnIndex || columnIndex === fullNameColumnIndex) {
          continue;
        }

        const rawHeader = firstDataCandidate.cells[columnIndex]?.trim() ?? "";
        const rawValue = row.cells[columnIndex]?.trim() ?? "";

        if (!rawHeader || !rawValue) {
          continue;
        }

        const normalizedKey = normalizeProfileFieldKey(rawHeader);
        if (!normalizedKey) {
          continue;
        }

        profileData[normalizedKey] = rawValue;
      }
    }

    if (fullName) {
      profileData.full_name = fullName;
    } else {
      const firstName = profileData.first_name?.trim();
      const lastName = profileData.last_name?.trim();

      if (firstName || lastName) {
        profileData.full_name = [firstName, lastName].filter(Boolean).join(" ");
      }
    }

    validRows.push({
      rowNumber: row.sourceRowNumber,
      email: normalizedEmail,
      fullName,
      profileData,
    });
  }

  const totalRows = Math.max(indexedRows.length - rowStartIndex, 0);

  return {
    fileType,
    rows: validRows,
    invalidRows,
    summary: {
      totalRows,
      validRows: validRows.length,
      invalidRows: invalidRows.length,
      duplicateRows,
      skippedEmptyRows,
    },
  };
}
