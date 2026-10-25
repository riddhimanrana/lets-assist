import { cn } from "@/lib/utils";

/** A small grid that shades where the report will land in the sheet. */
export function MiniSheetPreview({
  rangeA1,
  previewRows,
  columns,
}: {
  rangeA1: string;
  previewRows: string[][] | null;
  columns: string[];
}) {
  const visibleColumns = columns.slice(0, 8);
  const visibleRows = 10;
  const dataRows = previewRows?.length || 4;
  const dataColumns = Math.max(
    previewRows?.reduce((max, row) => Math.max(max, row.length), 0) || 4,
    1,
  );

  const parseCell = (cell: string) => {
    const match = cell.match(/^([A-Za-z]+)(\d+)$/);
    if (!match) return null;
    return {
      column: match[1].toUpperCase(),
      row: Number.parseInt(match[2], 10),
    };
  };

  const columnToIndex = (column: string) =>
    column
      .toUpperCase()
      .split("")
      .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);

  const range = rangeA1.includes("!") ? rangeA1.split("!")[1] : rangeA1;
  const startCell = parseCell(range.split(":")[0] || "A1") || {
    column: "A",
    row: 1,
  };
  const startColumnIndex = columnToIndex(startCell.column);
  const overlayEndColumn = startColumnIndex + dataColumns - 1;
  const overlayEndRow = startCell.row + dataRows - 1;

  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-sm">
        Placement preview (top-left at {startCell.column}
        {startCell.row})
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              <th className="text-muted-foreground w-8"></th>
              {visibleColumns.map((col) => (
                <th
                  key={col}
                  className="text-muted-foreground px-2 py-1 text-center font-medium"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: visibleRows }, (_, rowIndex) => {
              const rowNumber = rowIndex + 1;
              return (
                <tr key={rowNumber} className="border-t">
                  <td className="text-muted-foreground px-1 py-1 text-center">
                    {rowNumber}
                  </td>
                  {visibleColumns.map((col) => {
                    const colIndex = columnToIndex(col);
                    const isOverlay =
                      colIndex >= startColumnIndex &&
                      colIndex <= overlayEndColumn &&
                      rowNumber >= startCell.row &&
                      rowNumber <= overlayEndRow;

                    return (
                      <td
                        key={`${col}-${rowNumber}`}
                        className={cn(
                          "h-5 w-10 border-l text-center",
                          isOverlay ? "bg-primary/15" : "bg-transparent",
                        )}
                      ></td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
