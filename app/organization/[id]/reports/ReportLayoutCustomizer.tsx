import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GripVertical, Trash2, Eye, EyeOff, RotateCw } from "lucide-react";
import {
  DEFAULT_COLUMNS,
  getDefaultLayout,
  type ReportLayoutConfig,
  type ReportType,
} from "./report-layouts";

interface ReportLayoutCustomizerProps {
  reportType: ReportType;
  currentLayout: ReportLayoutConfig | null;
  onLayoutChange: (layout: ReportLayoutConfig) => void;
  isLoading?: boolean;
  onReset?: () => void;
}

export function ReportLayoutCustomizer({
  reportType,
  currentLayout,
  onLayoutChange,
  isLoading = false,
  onReset,
}: ReportLayoutCustomizerProps) {
  const [layout, setLayout] = React.useState<ReportLayoutConfig>(
    currentLayout || getDefaultLayout(reportType),
  );
  const availableColumns = React.useMemo(
    () => DEFAULT_COLUMNS[reportType],
    [reportType],
  );
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [showResetDialog, setShowResetDialog] = React.useState(false);

  React.useEffect(() => {
    setLayout(currentLayout || getDefaultLayout(reportType));
  }, [currentLayout, reportType]);

  const handleOrientationChange = (orientation: "horizontal" | "vertical") => {
    const updated = { ...layout, orientation };
    setLayout(updated);
    onLayoutChange(updated);
  };

  const handleToggleColumn = (columnKey: string) => {
    const updated = {
      ...layout,
      columns: layout.columns.some((c) => c.key === columnKey)
        ? layout.columns.filter((c) => c.key !== columnKey)
        : [
            ...layout.columns,
            availableColumns.find((c) => c.key === columnKey)!,
          ],
    };
    setLayout(updated);
    onLayoutChange(updated);
  };

  const handleRemoveColumn = (index: number) => {
    const updated = {
      ...layout,
      columns: layout.columns.filter((_, i) => i !== index),
    };
    setLayout(updated);
    onLayoutChange(updated);
  };

  const handleReorderColumn = (fromIndex: number, toIndex: number) => {
    const newColumns = [...layout.columns];
    const [moved] = newColumns.splice(fromIndex, 1);
    newColumns.splice(toIndex, 0, moved);
    const updated = { ...layout, columns: newColumns };
    setLayout(updated);
    onLayoutChange(updated);
  };

  const handleReset = () => {
    const defaultLayout = getDefaultLayout(reportType);
    setLayout(defaultLayout);
    onLayoutChange(defaultLayout);
    setShowResetDialog(false);
    onReset?.();
  };

  const selectedColumnKeys = new Set(layout.columns.map((c) => c.key));

  return (
    <div className="grid gap-6">
      <div className="grid gap-6">
        {/* Orientation Toggle */}
        <div className="grid gap-2">
          <Label>Layout orientation</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant={
                layout.orientation === "horizontal" ? "secondary" : "outline"
              }
              aria-pressed={layout.orientation === "horizontal"}
              onClick={() => handleOrientationChange("horizontal")}
              disabled={isLoading}
              className="flex-1"
            >
              Horizontal (traditional)
            </Button>
            <Button
              variant={
                layout.orientation === "vertical" ? "secondary" : "outline"
              }
              aria-pressed={layout.orientation === "vertical"}
              onClick={() => handleOrientationChange("vertical")}
              disabled={isLoading}
              className="flex-1"
            >
              Vertical (custom)
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            {layout.orientation === "horizontal"
              ? "Each record is a row with columns for each field"
              : "Each record takes multiple rows, one field per row"}
          </p>
        </div>

        {/* Columns Configuration */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label>Columns</Label>
            <Button
              variant="ghost"
              onClick={() => setShowResetDialog(true)}
              disabled={isLoading}
            >
              <RotateCw data-icon="inline-start" />
              Reset
            </Button>
          </div>

          <Tabs defaultValue="selected" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="selected">
                Selected ({layout.columns.length})
              </TabsTrigger>
              <TabsTrigger value="available">
                Available ({availableColumns.length - layout.columns.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="selected" className="mt-3 grid gap-2">
              {layout.columns.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  No columns selected. Add columns to display data.
                </div>
              ) : (
                <div className="grid gap-2">
                  {layout.columns.map((column, index) => (
                    <div
                      key={column.key}
                      className="flex items-center gap-2 rounded-md border p-2"
                      draggable
                      onDragStart={() => setDraggedIndex(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (draggedIndex !== null && draggedIndex !== index) {
                          handleReorderColumn(draggedIndex, index);
                          setDraggedIndex(null);
                        }
                      }}
                    >
                      <GripVertical className="text-muted-foreground size-4 shrink-0 cursor-grab active:cursor-grabbing" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{column.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {column.key}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${column.label}`}
                        onClick={() => handleRemoveColumn(index)}
                        disabled={isLoading}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="available" className="mt-3 grid gap-2">
              <div className="grid gap-2">
                {availableColumns.map((column) => {
                  const isSelected = selectedColumnKeys.has(column.key);
                  return (
                    <button
                      type="button"
                      key={column.key}
                      onClick={() => handleToggleColumn(column.key)}
                      disabled={isLoading}
                      className="hover:bg-muted flex min-h-9 w-full items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSelected ? (
                        <Eye className="text-primary size-4 shrink-0" />
                      ) : (
                        <EyeOff className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{column.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {column.key}
                        </p>
                      </div>
                      {isSelected && (
                        <span className="text-xs font-medium text-primary">
                          Added
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Reset Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset layout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the default layout with all original columns in
              their default order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              Reset layout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
