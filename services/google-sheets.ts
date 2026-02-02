const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

const columnToIndex = (column: string) => {
  return column
    .toUpperCase()
    .split("")
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
};

const indexToColumn = (index: number) => {
  let value = index;
  let column = "";
  while (value > 0) {
    const modulo = (value - 1) % 26;
    column = String.fromCharCode(65 + modulo) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
};

const parseA1Cell = (cell: string) => {
  const match = cell.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return {
    column: match[1].toUpperCase(),
    row: Number.parseInt(match[2], 10),
  };
};

const parseA1Range = (range: string) => {
  const trimmed = range.trim();
  if (!trimmed) return null;
  const [tabPart, rangePart] = trimmed.includes("!")
    ? trimmed.split("!")
    : [null, trimmed];
  const [startPart, endPart] = rangePart.split(":");
  const start = parseA1Cell(startPart);
  const end = endPart ? parseA1Cell(endPart) : null;
  if (!start) return null;
  return {
    tabName: tabPart || null,
    start,
    end,
  };
};

export function buildWriteRange(
  tabName: string,
  rangeA1: string | null | undefined,
  rows: string[][]
) {
  const totalRows = Math.max(rows.length, 1);
  const totalColumns = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1
  );
  const parsed = rangeA1 ? parseA1Range(rangeA1) : null;
  const startColumn = parsed?.start.column ?? "A";
  const startRow = parsed?.start.row ?? 1;
  const startIndex = columnToIndex(startColumn);
  const endColumn = indexToColumn(startIndex + totalColumns - 1);
  const endRow = startRow + totalRows - 1;
  const resolvedTab = parsed?.tabName || tabName;

  return `${resolvedTab}!${startColumn}${startRow}:${endColumn}${endRow}`;
}

export async function createSpreadsheet(
  accessToken: string,
  title: string,
  tabName: string
): Promise<{ sheetId: string; sheetUrl: string; tabName: string; sheetTitle: string } | null> {
  try {
    const response = await fetch(GOOGLE_SHEETS_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [
          {
            properties: {
              title: tabName,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to create spreadsheet:", error);
      return null;
    }

    const data = await response.json();
    return {
      sheetId: data.spreadsheetId,
      sheetUrl: data.spreadsheetUrl,
      tabName,
      sheetTitle: data.properties?.title || title,
    };
  } catch (error) {
    console.error("Error creating spreadsheet:", error);
    return null;
  }
}

export function extractSpreadsheetId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export function buildSpreadsheetUrl(sheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  sheetId: string
): Promise<{ sheetId: string; sheetTitle: string; tabs: string[] } | null> {
  try {
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId
      )}?fields=spreadsheetId,properties.title,sheets.properties.title`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to fetch spreadsheet metadata:", error);
      return null;
    }

    const data = await response.json();
    const tabs = (data.sheets || [])
      .map((sheet: { properties?: { title?: string } }) => sheet.properties?.title)
      .filter((title: string | undefined): title is string => Boolean(title));

    return {
      sheetId: data.spreadsheetId,
      sheetTitle: data.properties?.title || "Untitled Spreadsheet",
      tabs,
    };
  } catch (error) {
    console.error("Error fetching spreadsheet metadata:", error);
    return null;
  }
}

export async function ensureSpreadsheetTab(
  accessToken: string,
  sheetId: string,
  tabName: string
): Promise<boolean> {
  try {
    const metadata = await getSpreadsheetMetadata(accessToken, sheetId);
    if (!metadata) return false;
    if (metadata.tabs.some((tab) => tab === tabName)) return true;

    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: tabName,
                },
              },
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to create sheet tab:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error ensuring sheet tab:", error);
    return false;
  }
}

export async function updateSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  range: string,
  rows: string[][]
): Promise<boolean> {
  try {
    const resolvedRange = range || "A1";
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId
      )}/values/${encodeURIComponent(resolvedRange)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range: resolvedRange,
          majorDimension: "ROWS",
          values: rows,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to update spreadsheet values:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error updating spreadsheet values:", error);
    return false;
  }
}
