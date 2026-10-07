"use client";

import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { rangeModeLabels } from "./sheet-sync-options";

export type RangeBuilderProps = {
  columns: string[];
  mode: "full" | "custom";
  onModeChange: (value: "full" | "custom") => void;
  startColumn: string;
  startRow: string;
  endColumn: string;
  endRow: string;
  onStartColumnChange: (value: string) => void;
  onStartRowChange: (value: string) => void;
  onEndColumnChange: (value: string) => void;
  onEndRowChange: (value: string) => void;
  disabled?: boolean;
  helperText?: string;
};

export function RangeBuilder({
  columns,
  mode,
  onModeChange,
  startColumn,
  startRow,
  endColumn,
  endRow,
  onStartColumnChange,
  onStartRowChange,
  onEndColumnChange,
  onEndRowChange,
  disabled,
  helperText,
}: RangeBuilderProps) {
  const sanitizeRow = (value: string) => value.replace(/\D/g, "");
  const columnToIndex = (column: string) =>
    column
      .toUpperCase()
      .split("")
      .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
  const indexToColumn = (index: number) => {
    let value = index;
    let column = "";
    while (value > 0) {
      const modulo = (value - 1) % 26;
      column = String.fromCharCode(65 + modulo) + column;
      value = Math.floor((value - 1) / 26);
    }
    return column || "A";
  };

  const startColumnIndex = columnToIndex(startColumn || "A");
  const endColumnIndex = columnToIndex(endColumn || startColumn || "A");
  const columnSpan = Math.max(endColumnIndex - startColumnIndex + 1, 1);
  const startRowNumber = Math.max(Number.parseInt(startRow || "1", 10) || 1, 1);
  const endRowNumber = Math.max(
    Number.parseInt(endRow || startRow || "1", 10) || 1,
    1,
  );
  const rowSpan = Math.max(endRowNumber - startRowNumber + 1, 1);

  useEffect(() => {
    if (startColumnIndex > endColumnIndex) {
      onEndColumnChange(startColumn);
    }
    if (startRowNumber > endRowNumber) {
      onEndRowChange(String(startRowNumber));
    }
  }, [
    startColumnIndex,
    endColumnIndex,
    startRowNumber,
    endRowNumber,
    onEndColumnChange,
    onEndRowChange,
    startColumn,
  ]);

  const handleColumnSpanChange = (value: string) => {
    const span = Math.max(Number.parseInt(value, 10) || 1, 1);
    const newEndIndex = startColumnIndex + span - 1;
    onEndColumnChange(indexToColumn(newEndIndex));
  };

  const handleRowSpanChange = (value: string) => {
    const span = Math.max(Number.parseInt(value, 10) || 1, 1);
    const newEndRow = startRowNumber + span - 1;
    onEndRowChange(String(newEndRow));
  };

  const rangeLabel =
    mode === "full"
      ? "A1"
      : `${startColumn}${startRowNumber}:${indexToColumn(
          startColumnIndex + columnSpan - 1,
        )}${startRowNumber + rowSpan - 1}`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={mode}
          onValueChange={(value) => onModeChange(value as "full" | "custom")}
          disabled={disabled}
        >
          <SelectTrigger className="w-fit" aria-label="Range mode">
            <SelectValue placeholder="Range mode">
              {rangeModeLabels[mode]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="full">Full tab (A1)</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Badge variant="secondary">Range: {rangeLabel}</Badge>
      </div>

      {mode === "custom" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <p className="text-sm font-medium">Anchor (top-left)</p>
            <div className="flex items-center gap-2">
              <Select
                value={startColumn}
                onValueChange={(val) => val && onStartColumnChange(val)}
                disabled={disabled}
              >
                <SelectTrigger className="w-24" aria-label="Anchor column">
                  <SelectValue placeholder="Col" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {columns.map((column) => (
                      <SelectItem key={column} value={column}>
                        {column}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                value={startRow}
                aria-label="Anchor row"
                onChange={(event) =>
                  onStartRowChange(sanitizeRow(event.target.value))
                }
                disabled={disabled}
              />
            </div>
            <p className="text-muted-foreground text-sm">
              Data starts here and expands to fit the report.
            </p>
          </div>
          <div className="grid content-start gap-2">
            <p className="text-sm font-medium">Span (preview only)</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-muted-foreground text-xs">Columns</span>
                <Input
                  type="number"
                  min={1}
                  max={26}
                  value={columnSpan}
                  onChange={(event) =>
                    handleColumnSpanChange(event.target.value)
                  }
                  disabled={disabled}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-muted-foreground text-xs">Rows</span>
                <Input
                  type="number"
                  min={1}
                  value={rowSpan}
                  onChange={(event) => handleRowSpanChange(event.target.value)}
                  disabled={disabled}
                />
              </label>
            </div>
            <p className="text-muted-foreground text-sm">
              This doesn’t limit data; it just helps visualize placement.
            </p>
          </div>
        </div>
      )}

      {helperText && (
        <p className="text-muted-foreground text-sm">{helperText}</p>
      )}
    </div>
  );
}
