"use client";

import { AlertTriangle } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { IntegrationOption } from "../../settings/IntegrationCard";
import type { SheetSyncStatus } from "../sheets-actions";
import { SheetDestinationFields } from "./SheetDestinationFields";
import { SheetLayoutPreview } from "./SheetLayoutPreview";
import {
  getSyncIntervalLabel,
  syncIntervalOptions,
  type SheetOwnerOption,
} from "./sheet-sync-options";
import type { SheetSyncSetup } from "./useSheetSyncSetup";

/**
 * Everything an admin can change on an existing sync: where it writes, how the
 * report is laid out, and who and how often it runs.
 */
export function SheetSyncConfig({
  syncConfig,
  setup,
  sections,
  onSectionsChange,
  connectedBy,
  connectedByLabel,
  availableOwners,
  loadingOwners,
  onOwnerChange,
  settingsDisabled,
  onToggleAutoSync,
  onIntervalChange,
}: {
  syncConfig: NonNullable<SheetSyncStatus["syncConfig"]>;
  setup: SheetSyncSetup;
  sections: string[];
  onSectionsChange: (sections: string[]) => void;
  connectedBy: SheetSyncStatus["connectedBy"];
  connectedByLabel: string | null;
  availableOwners: SheetOwnerOption[];
  loadingOwners: boolean;
  onOwnerChange: (ownerId: string | null) => void;
  settingsDisabled: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
  onIntervalChange: (interval: string | null) => void;
}) {
  const ownerMissing =
    availableOwners.length > 0 &&
    !availableOwners.some((owner) => owner.id === connectedBy?.id);

  return (
    <Accordion
      value={sections}
      onValueChange={(value) => value && onSectionsChange(value)}
      className="rounded-md border px-3"
    >
      <AccordionItem value="destination">
        <AccordionTrigger>Destination</AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-4">
            <SheetDestinationFields
              idPrefix="sheet-config"
              destination={setup.destination}
              rangeHint="Use this as the top-left anchor. Data expands to fit the report columns."
              rangeFooter={
                syncConfig.sheetUrl ? (
                  <a
                    href={syncConfig.sheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary w-fit text-sm underline underline-offset-4"
                  >
                    Open the sheet to pick a range
                  </a>
                ) : null
              }
            />
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={setup.handleUpdateSheetConfig}
                disabled={setup.savingConfig}
              >
                Save destination changes
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="layout">
        <AccordionTrigger>Layout and preview</AccordionTrigger>
        <AccordionContent>
          <SheetLayoutPreview
            layout={setup.layout}
            action={
              <Button
                variant="outline"
                onClick={setup.handleUpdateSheetConfig}
                disabled={setup.savingConfig}
              >
                Update layout
              </Button>
            }
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="automation">
        <AccordionTrigger>Owner and automation</AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-4">
            <IntegrationOption
              htmlFor="sheet-sync-auto"
              label="Automatic sync"
              description="Update the spreadsheet in the background"
            >
              <Switch
                id="sheet-sync-auto"
                checked={syncConfig.autoSync}
                onCheckedChange={onToggleAutoSync}
                disabled={settingsDisabled}
              />
            </IntegrationOption>

            <IntegrationOption
              htmlFor="sheet-sync-interval"
              label="Sync interval"
              description="How frequently to push updates"
            >
              <Select
                value={String(syncConfig.syncIntervalMinutes)}
                onValueChange={onIntervalChange}
                disabled={settingsDisabled}
              >
                <SelectTrigger id="sheet-sync-interval" className="w-40">
                  <SelectValue placeholder="Interval">
                    {getSyncIntervalLabel(syncConfig.syncIntervalMinutes)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {syncIntervalOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </IntegrationOption>

            <div className="grid gap-2">
              <div className="grid gap-0.5">
                <label
                  htmlFor="sheet-sync-owner"
                  className="text-sm font-medium"
                >
                  Credential owner
                </label>
                <p className="text-muted-foreground text-sm">
                  Switch which admin account provides the Sheets API access. The
                  owner account supplies Sheets credentials for sync jobs.
                </p>
              </div>
              <Select
                value={connectedBy?.id || ""}
                onValueChange={onOwnerChange}
                disabled={loadingOwners || availableOwners.length <= 1}
              >
                <SelectTrigger id="sheet-sync-owner" className="w-full">
                  <SelectValue
                    placeholder={
                      loadingOwners
                        ? "Loading admins..."
                        : "Select credentials owner"
                    }
                  >
                    {connectedByLabel ?? undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {availableOwners.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        {owner.name || owner.email || "Member"}
                        {owner.connectedEmail
                          ? ` · Linked: ${owner.connectedEmail}`
                          : " · Not linked to Google"}
                        {!owner.hasSheetsAccess && owner.connectedEmail
                          ? " (missing Sheets permissions)"
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {ownerMissing && (
                <p className="text-warning flex items-center gap-1.5 text-sm">
                  <AlertTriangle className="size-4 shrink-0" />
                  Current owner is not in the organization member list.
                </p>
              )}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
