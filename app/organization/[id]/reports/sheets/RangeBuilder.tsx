"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  RANGE_END_EXPLANATION,
  buildRangeA1,
  rangeModeLabels,
} from "./sheet-sync-options";

/** The select needs a value for "no end column"; the field itself is empty. */
const OPEN_END = "open";

export type RangeBuilderProps = {
  columns: string[];
  mode: "full" | "custom";
  onModeChange: (value: "full" | "custom") => void;
  startColumn: string;
  startRow: string;
  /** Empty when the range has no end. */
  endColumn: string;
  /** Empty when the range has no end. */
  endRow: string;
  onStartColumnChange: (value: string) => void;
  onStartRowChange: (value: string) => void;
  onEndColumnChange: (value: string) => void;
  onEndRowChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * Where the report is written: the whole tab from A1, or a start cell with an
 * optional end. Without an end the report grows; with one it is a fixed box.
 */
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
}: RangeBuilderProps) {
  const sanitizeRow = (value: string) => value.replace(/\D/g, "");
  const rangeLabel = buildRangeA1({
    mode,
    startColumn,
    startRow,
    endColumn,
    endRow,
  });
  const hasEndColumn = Boolean(endColumn);
  const hasEndRow = Boolean(endRow);
  const endIsPartial = hasEndColumn !== hasEndRow;

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
              <SelectItem value="full">{rangeModeLabels.full}</SelectItem>
              <SelectItem value="custom">{rangeModeLabels.custom}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Badge variant="secondary">Range: {rangeLabel}</Badge>
      </div>

      {mode === "custom" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <p className="text-sm font-medium">Start cell</p>
            <div className="flex items-center gap-2">
              <Select
                value={startColumn}
                onValueChange={(val) => val && onStartColumnChange(val)}
                disabled={disabled}
              >
                <SelectTrigger className="w-24" aria-label="Start column">
                  <SelectValue placeholder="Column" />
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
                aria-label="Start row"
                onChange={(event) =>
                  onStartRowChange(sanitizeRow(event.target.value))
                }
                disabled={disabled}
              />
            </div>
            <p className="text-muted-foreground text-sm">
              The report starts in this cell.
            </p>
          </div>
          <div className="grid content-start gap-2">
            <p className="text-sm font-medium">Range end (optional)</p>
            <div className="flex items-center gap-2">
              <Select
                value={endColumn || OPEN_END}
                onValueChange={(val) =>
                  val && onEndColumnChange(val === OPEN_END ? "" : val)
                }
                disabled={disabled}
              >
                <SelectTrigger className="w-24" aria-label="End column">
                  <SelectValue placeholder="Column">
                    {endColumn || "Open"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={OPEN_END}>Open</SelectItem>
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
                value={endRow}
                placeholder="Open"
                aria-label="End row"
                onChange={(event) =>
                  onEndRowChange(sanitizeRow(event.target.value))
                }
                disabled={disabled}
              />
              {(hasEndColumn || hasEndRow) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onEndColumnChange("");
                    onEndRowChange("");
                  }}
                  disabled={disabled}
                >
                  Remove end
                </Button>
              )}
            </div>
            {endIsPartial && (
              <p className="text-muted-foreground text-sm">
                Set both an end column and an end row. Until then the end stays
                open.
              </p>
            )}
          </div>
        </div>
      )}

      <p className="text-muted-foreground text-sm">{RANGE_END_EXPLANATION}</p>
    </div>
  );
}
