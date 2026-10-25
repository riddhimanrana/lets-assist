"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ReportLayoutCustomizer } from "../ReportLayoutCustomizer";
import { MiniSheetPreview } from "./MiniSheetPreview";
import type { SheetSyncSetup } from "./useSheetSyncSetup";

/**
 * The one layout block: column and orientation choices, a data preview, and a
 * picture of where the report lands. `action` is the save, create or connect
 * button for the surrounding state.
 */
export function SheetLayoutPreview({
  layout,
  previewDisabled,
  action,
}: {
  layout: SheetSyncSetup["layout"];
  previewDisabled?: boolean;
  action?: ReactNode;
}) {
  const { previewRows, previewLoading } = layout;

  return (
    <div className="grid gap-4">
      <ReportLayoutCustomizer
        reportType={layout.reportType}
        currentLayout={layout.layoutConfig}
        onLayoutChange={(config) => layout.setLayoutConfig(config)}
        isLoading={previewLoading}
        onReset={() => layout.setPreviewRows(null)}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={layout.handlePreviewReport}
          disabled={previewLoading || previewDisabled}
        >
          {previewLoading ? "Loading preview..." : "Preview data"}
        </Button>
        {action}
      </div>

      {previewRows && (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <p className="text-muted-foreground text-sm">
              Preview (first {Math.max(previewRows.length - 1, 0)} rows)
            </p>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {previewRows[0]?.map((cell, index) => (
                      <TableHead key={index}>{cell}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.slice(1).map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <TableCell
                          key={cellIndex}
                          className="text-muted-foreground"
                        >
                          {cell || "-"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <MiniSheetPreview
            rangeA1={layout.rangeA1}
            previewRows={previewRows}
            columns={layout.columns}
          />
        </div>
      )}
    </div>
  );
}
