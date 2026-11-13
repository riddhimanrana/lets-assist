import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

import { CSV_FILE_INPUT_ID } from "./useCsvVerification";

/** Step 1: choose the exported certificate file. */
export function CsvVerificationUploadStep({
  files,
  disabled,
  onFileChange,
  onRemove,
}: {
  files: File[];
  disabled: boolean;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={CSV_FILE_INPUT_ID}>Certificate CSV files</FieldLabel>
      <div className="hover:bg-muted/50 relative rounded-lg border border-dashed transition-colors has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
        <input
          id={CSV_FILE_INPUT_ID}
          key={files.map((file) => file.name).join("|") || "no-file"} // Force re-render when file changes
          type="file"
          multiple
          accept=".csv"
          onChange={onFileChange}
          className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          disabled={disabled}
          aria-describedby="csv-file-columns"
        />
        <div className="flex min-h-24 items-center gap-3 px-4 py-4">
          <FileText
            aria-hidden="true"
            className="text-muted-foreground size-5 shrink-0"
          />
          {files.length > 0 ? (
            <div className="grid min-w-0 gap-0.5">
              <p className="truncate text-sm font-medium">
                {files.map((file) => file.name).join(", ")}
              </p>
              <p className="text-muted-foreground text-sm">
                {files.length} files selected. Select again to replace them.
              </p>
            </div>
          ) : (
            <div className="grid gap-0.5">
              <p className="text-sm font-medium">Click to select CSV files</p>
              <p className="text-muted-foreground text-sm">
                or drag and drop here
              </p>
            </div>
          )}
        </div>
      </div>
      {files.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={onRemove}
          disabled={disabled}
        >
          Remove files
        </Button>
      ) : null}
      <FieldDescription id="csv-file-columns">
        The CSV should contain columns for Certificate ID, Project Title,
        Organization Name, Project Organizer Name, Certification Status,
        Certificate Type (verified/self-reported), and other certificate details
      </FieldDescription>
    </Field>
  );
}
