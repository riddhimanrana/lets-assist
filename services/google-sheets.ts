const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export async function createSpreadsheet(
  accessToken: string,
  title: string,
  tabName: string
): Promise<{ sheetId: string; sheetUrl: string; tabName: string } | null> {
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
    };
  } catch (error) {
    console.error("Error creating spreadsheet:", error);
    return null;
  }
}

export async function updateSpreadsheetValues(
  accessToken: string,
  sheetId: string,
  tabName: string,
  rows: string[][]
): Promise<boolean> {
  try {
    const range = `${tabName}!A1`;
    const response = await fetch(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        sheetId
      )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range,
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
