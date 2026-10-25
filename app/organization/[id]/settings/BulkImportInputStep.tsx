"use client";

import { AlertCircle, FileSpreadsheet, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getInvitationDurationLabel,
  type InvitationDuration,
} from "@/lib/organization/invitation-utils";
import type { ContactImportRole } from "@/types/contact-import";

import {
  INVITATION_DURATION_OPTIONS,
  ROLE_OPTIONS,
  formatFileSize,
  type ImportMode,
} from "./bulk-import-shared";

type BulkImportInputStepProps = {
  mode: ImportMode;
  role: ContactImportRole;
  invitationDuration: InvitationDuration;
  emailInput: string;
  validEmailCount: number;
  selectedFile: File | null;
  uploadError: string | null;
  isProcessingImport: boolean;
  onModeChange: (mode: ImportMode) => void;
  onRoleChange: (role: ContactImportRole) => void;
  onInvitationDurationChange: (duration: InvitationDuration) => void;
  onEmailInputChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onCancel: () => void;
  onPreview: () => void;
  onStartFileImport: () => void;
};

/** First step: who to invite, for how long, and the file or pasted list. */
export default function BulkImportInputStep({
  mode,
  role,
  invitationDuration,
  emailInput,
  validEmailCount,
  selectedFile,
  uploadError,
  isProcessingImport,
  onModeChange,
  onRoleChange,
  onInvitationDurationChange,
  onEmailInputChange,
  onFileChange,
  onCancel,
  onPreview,
  onStartFileImport,
}: BulkImportInputStepProps) {
  const hasValidEmails = validEmailCount > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import members</DialogTitle>
        <DialogDescription>
          Upload a CSV or Excel file, or paste a copied list. The email column
          is found automatically.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="role">Invite as</FieldLabel>
            <Select
              items={ROLE_OPTIONS}
              value={role}
              onValueChange={(v) => onRoleChange(v as ContactImportRole)}
            >
              <SelectTrigger id="role" className="w-full">
                <SelectValue placeholder="Invite as" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {role === "staff"
                ? "Staff can verify hours and help manage the organization."
                : "Members can participate in volunteer opportunities."}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="invitation-duration">
              Invitation validity
            </FieldLabel>
            <Select
              items={INVITATION_DURATION_OPTIONS}
              value={invitationDuration}
              onValueChange={(v) =>
                onInvitationDurationChange(v as InvitationDuration)
              }
            >
              <SelectTrigger id="invitation-duration" className="w-full">
                <SelectValue placeholder="Invitation validity" />
              </SelectTrigger>
              <SelectContent>
                {INVITATION_DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              New invitations in this run will expire in{" "}
              {getInvitationDurationLabel(invitationDuration)}.
            </FieldDescription>
          </Field>
        </div>

        <Tabs
          value={mode}
          onValueChange={(value) => onModeChange(value as ImportMode)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="file" className="w-full">
              File upload
            </TabsTrigger>
            <TabsTrigger value="manual" className="w-full">
              Paste emails
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="grid gap-4 pt-2">
            <Field>
              <FieldLabel htmlFor="import-file">CSV or Excel file</FieldLabel>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) =>
                  onFileChange(event.target.files?.[0] || null)
                }
              />
              <FieldDescription>
                We support CSV, XLSX, and XLS. Use one contact per row.
              </FieldDescription>
            </Field>

            {selectedFile && (
              <Alert>
                <FileSpreadsheet />
                <AlertTitle>{selectedFile.name}</AlertTitle>
                <AlertDescription>
                  {formatFileSize(selectedFile.size)} · ready to import.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          <TabsContent value="manual" className="grid gap-4 pt-2">
            <Field>
              <FieldLabel htmlFor="emails">Email addresses</FieldLabel>
              <Textarea
                id="emails"
                placeholder="Enter email addresses separated by commas, semicolons, or new lines:

john@example.com
jane@example.com
bob@example.com"
                value={emailInput}
                onChange={(e) => onEmailInputChange(e.target.value)}
                className="min-h-40 font-mono text-sm"
              />
              <FieldDescription>
                Supports copied text, CSV-style rows, and Name &lt;email&gt;
                format.
              </FieldDescription>
            </Field>

            {emailInput.trim() && (
              <Alert variant={hasValidEmails ? "default" : "destructive"}>
                <AlertCircle />
                <AlertTitle>
                  {hasValidEmails
                    ? `${validEmailCount} valid email${validEmailCount !== 1 ? "s" : ""} found`
                    : "No valid emails found"}
                </AlertTitle>
                <AlertDescription>
                  {hasValidEmails
                    ? "Click Preview to review before sending invitations."
                    : "Please enter valid email addresses."}
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>

        {uploadError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Import error</AlertTitle>
            <AlertDescription>{uploadError}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {mode === "manual" ? (
          <Button onClick={onPreview} disabled={!hasValidEmails}>
            Preview
          </Button>
        ) : (
          <Button
            onClick={onStartFileImport}
            disabled={!selectedFile || isProcessingImport}
          >
            {isProcessingImport ? (
              <>
                <Loader2 className="animate-spin" />
                Starting import...
              </>
            ) : (
              "Start import"
            )}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
