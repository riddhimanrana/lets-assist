"use client";

import { AlertTriangle } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { SheetDestinationFields } from "./SheetDestinationFields";
import { SheetLayoutPreview } from "./SheetLayoutPreview";
import type { SheetSyncSetup } from "./useSheetSyncSetup";

/**
 * First-time setup: create a new spreadsheet or connect an existing one, choose
 * what to write and where, then confirm.
 */
export function SheetSetupPanel({
  setup,
  setupBlockedReason,
  reconnectLabel,
  onReconnect,
}: {
  setup: SheetSyncSetup;
  setupBlockedReason: string | null;
  reconnectLabel: string;
  onReconnect: () => void;
}) {
  const blocked = Boolean(setupBlockedReason);
  const { setupMode, sheetMetadata } = setup;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Set up a spreadsheet</h3>
        <p className="text-muted-foreground text-sm">
          Choose where organization reports are written. You can change the
          destination later.
        </p>
      </div>

      {setupBlockedReason && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Google connection needed</AlertTitle>
          <AlertDescription>
            <p>{setupBlockedReason}</p>
            <Button variant="outline" onClick={onReconnect}>
              {reconnectLabel}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div
        className="grid gap-2 sm:grid-cols-2"
        role="group"
        aria-label="Spreadsheet source"
      >
        <Button
          variant={setupMode === "create" ? "secondary" : "outline"}
          aria-pressed={setupMode === "create"}
          onClick={() => setup.handleSetupModeChange("create")}
          disabled={blocked}
        >
          Create new sheet
        </Button>
        <Button
          variant={setupMode === "existing" ? "secondary" : "outline"}
          aria-pressed={setupMode === "existing"}
          onClick={() => setup.handleSetupModeChange("existing")}
          disabled={blocked}
        >
          Connect existing sheet
        </Button>
      </div>

      {setupMode === "existing" && (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <p className="text-sm font-medium">Spreadsheet</p>
            <Button
              variant="outline"
              className="w-fit"
              onClick={setup.handleOpenPicker}
              disabled={setup.pickerLoading || blocked}
            >
              {setup.pickerLoading ? "Opening..." : "Choose from Google Drive"}
            </Button>
            <p className="text-muted-foreground text-sm">
              Let&apos;s Assist can only open a spreadsheet after you choose it
              here.
              {setup.pickerReady
                ? ""
                : " The picker opens in a new window. Allow pop-ups if it is blocked."}
            </p>
          </div>

          {sheetMetadata && (
            <div className="grid gap-2 rounded-md border p-3">
              <div className="grid gap-0.5">
                <p className="text-muted-foreground text-sm">Selected sheet</p>
                <p className="text-sm font-medium break-words">
                  {sheetMetadata.sheetTitle}
                </p>
                <a
                  href={sheetMetadata.sheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary w-fit text-sm underline underline-offset-4"
                >
                  Open in Google Sheets
                </a>
              </div>
              {sheetMetadata.tabs.length > 0 && (
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Use an existing tab"
                >
                  {sheetMetadata.tabs.map((tab) => (
                    <Button
                      key={tab}
                      variant="outline"
                      onClick={() => setup.destination.setSheetTabName(tab)}
                    >
                      {tab}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Field>
            <FieldLabel htmlFor="sheet-setup-spreadsheet">
              Or paste a link to a spreadsheet you chose before
            </FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="sheet-setup-spreadsheet"
                value={setup.sheetInput}
                onChange={(event) =>
                  setup.handleSheetInputChange(event.target.value)
                }
                placeholder="Google Sheets link or ID"
              />
              <Button
                variant="outline"
                onClick={() => setup.handleLoadSheetMetadata()}
                disabled={
                  !setup.sheetInput.trim() || setup.loadingMetadata || blocked
                }
              >
                {setup.loadingMetadata ? "Loading..." : "Load"}
              </Button>
            </div>
            <FieldDescription>
              A link works only for a file you already chose with the picker, or
              one Let&apos;s Assist created. For any other file, use Choose from
              Google Drive.
            </FieldDescription>
          </Field>
        </div>
      )}

      <SheetDestinationFields
        idPrefix="sheet-setup"
        destination={setup.destination}
        tabNameHint={
          setupMode === "existing"
            ? "Use an existing tab name or type a new one."
            : undefined
        }
        rangeHint="Full tab grows with the report. A custom range is a fixed box, and the sync stops with an error if the report no longer fits it."
      />

      <Accordion>
        <AccordionItem value="layout">
          <AccordionTrigger>Layout and preview</AccordionTrigger>
          <AccordionContent>
            <SheetLayoutPreview
              layout={setup.layout}
              previewDisabled={blocked}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {setup.setupError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Setup could not be completed</AlertTitle>
          <AlertDescription>{setup.setupError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        {setupMode === "create" ? (
          <Button
            onClick={setup.handleCreateSheet}
            disabled={setup.creatingSheet || blocked}
          >
            {setup.creatingSheet ? "Creating..." : "Create sheet"}
          </Button>
        ) : (
          <Button
            onClick={setup.handleConnectExistingSheet}
            disabled={setup.connectingSheet || !sheetMetadata || blocked}
          >
            {setup.connectingSheet ? "Connecting..." : "Connect sheet"}
          </Button>
        )}
      </div>
    </div>
  );
}
