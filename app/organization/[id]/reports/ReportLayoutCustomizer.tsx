import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    currentLayout || getDefaultLayout(reportType)
  );
  const availableColumns = React.useMemo(
    () => DEFAULT_COLUMNS[reportType],
    [reportType]
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
      columns:
        layout.columns.some((c) => c.key === columnKey)
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
    <Card className="border border-border">
      <CardHeader>
        <CardTitle className="text-lg">Report Layout</CardTitle>
        <CardDescription>
          Customize how your report is organized and displayed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Orientation Toggle */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Layout Orientation</Label>
          <div className="flex gap-2">
            <Button
              variant={layout.orientation === "horizontal" ? "default" : "outline-solid"}
              size="sm"
              onClick={() => handleOrientationChange("horizontal")}
              disabled={isLoading}
              className="flex-1"
            >
              Horizontal (Traditional)
            </Button>
            <Button
              variant={layout.orientation === "vertical" ? "default" : "outline-solid"}
              size="sm"
              onClick={() => handleOrientationChange("vertical")}
              disabled={isLoading}
              className="flex-1"
            >
              Vertical (Custom)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {layout.orientation === "horizontal"
              ? "Each record is a row with columns for each field"
              : "Each record takes multiple rows, one field per row"}
          </p>
        </div>

        {/* Columns Configuration */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Columns</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowResetDialog(true)}
              disabled={isLoading}
              className="h-7 px-2"
            >
              <RotateCw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          </div>

          <Tabs defaultValue="selected" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="selected" className="text-xs sm:text-sm">
                Selected ({layout.columns.length})
              </TabsTrigger>
              <TabsTrigger value="available" className="text-xs sm:text-sm">
                Available ({availableColumns.length - layout.columns.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="selected" className="space-y-2 mt-3">
              {layout.columns.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  No columns selected. Add columns to display data.
                </div>
              ) : (
                <div className="space-y-2">
                  {layout.columns.map((column, index) => (
                    <div
                      key={column.key}
                      className="flex items-center gap-2 p-2 border rounded-md bg-card hover:bg-accent/50 transition-colors"
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
                      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{column.label}</p>
                        <p className="text-xs text-muted-foreground">{column.key}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveColumn(index)}
                        disabled={isLoading}
                        className="h-7 w-7 p-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="available" className="space-y-2 mt-3">
              <div className="space-y-2">
                {availableColumns.map((column) => {
                  const isSelected = selectedColumnKeys.has(column.key);
                  return (
                    <button
                      key={column.key}
                      onClick={() => handleToggleColumn(column.key)}
                      disabled={isLoading}
                      className="w-full flex items-center gap-2 p-2 border rounded-md hover:bg-accent/50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSelected ? (
                        <Eye className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{column.label}</p>
                        <p className="text-xs text-muted-foreground">{column.key}</p>
                      </div>
                      {isSelected && <span className="text-xs font-medium text-primary">Added</span>}
                    </button>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>

      {/* Reset Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Layout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the default layout with all original columns in their default order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>Reset Layout</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
