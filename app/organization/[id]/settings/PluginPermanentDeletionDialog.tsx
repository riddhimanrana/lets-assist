"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { buildPluginDataDeletionConfirmationPhrase } from "@/lib/plugins/plugin-data-deletion-confirmation";
import type { OrganizationPluginAdminSetting } from "@/types";

import { permanentlyDeleteOrganizationPluginData } from "./actions";

type PluginPermanentDeletionDialogProps = {
  organizationId: string;
  organizationName: string;
  /** Plugin pending confirmation. `null` keeps the dialog closed. */
  plugin: OrganizationPluginAdminSetting | null;
  onClose: () => void;
  /** Called after a successful (non-idempotent) deletion so the parent can refresh its plugin list. */
  onDeleted: () => void;
};

/**
 * Confirmation dialog for permanent, per-organization plugin-data deletion.
 * Deliberately separate from the uninstall confirmation in
 * `OrganizationPluginSettings.tsx`: uninstall never runs plugin code and
 * always retains data, while this action runs `onDataDelete` and
 * irreversibly erases it. Requires typing the exact
 * `${organizationName}/${organizationId}/${pluginKey}` phrase so the
 * confirmation is bound to this exact organization and plugin.
 *
 * A fresh request key is generated when the dialog opens and remains bound
 * to that exact confirmation through retries. Reusing it is required for
 * durable replay: a lost response must return the receipt rather than run
 * plugin code again.
 */
export function PluginPermanentDeletionDialog({
  organizationId,
  organizationName,
  plugin,
  onClose,
  onDeleted,
}: PluginPermanentDeletionDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (plugin) {
      setConfirmationText("");
      setRequestKey(crypto.randomUUID());
    }
  }, [plugin]);

  if (!plugin) {
    return null;
  }

  const expectedPhrase = buildPluginDataDeletionConfirmationPhrase(
    organizationName,
    organizationId,
    plugin.key,
  );
  const confirmationMatches = confirmationText.trim() === expectedPhrase;

  const handleConfirm = async () => {
    if (!confirmationMatches || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      const response = await permanentlyDeleteOrganizationPluginData({
        organizationId,
        pluginKey: plugin.key,
        confirmationText,
        requestKey,
      });

      if (!response.success) {
        toast.error(
          response.error || "Failed to permanently delete plugin data.",
        );
        return;
      }

      if (response.auditWarning) {
        toast.warning(`${plugin.name} data permanently deleted`, {
          description: response.message,
        });
      } else {
        toast.success(`${plugin.name} data permanently deleted`, {
          description: response.message,
        });
      }
      onDeleted();
      onClose();
    } catch {
      toast.error("Connection error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) {
          onClose();
        }
      }}
    >
      <AlertDialogContent
        className="sm:max-w-md"
        aria-describedby="plugin-data-deletion-desc"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            Permanently delete {plugin.name} data?
          </AlertDialogTitle>
          <AlertDialogDescription id="plugin-data-deletion-desc">
            This is different from uninstalling. Uninstalling only removes the
            plugin&apos;s install record and settings — its stored data is kept.
            This action runs the plugin&apos;s own data-deletion code and
            permanently erases every manifest-declared tenant data target it
            manages for this organization. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            All declared tenant data {plugin.name} manages for{" "}
            {organizationName} will be permanently erased. Already-queued work
            using this data may fail.
          </AlertTitle>
          {plugin.dataDeletionExternalSystemsNotCovered.length > 0 ? (
            <AlertDescription className="grid gap-1">
              <p className="text-foreground text-sm font-medium">
                Not covered by this action
              </p>
              <ul className="text-muted-foreground grid gap-1 text-sm">
                {plugin.dataDeletionExternalSystemsNotCovered.map((system) => (
                  <li key={system}>{system}</li>
                ))}
              </ul>
            </AlertDescription>
          ) : null}
        </Alert>

        <Field>
          <FieldLabel htmlFor="plugin-data-deletion-confirmation">
            Type <span className="font-mono">{expectedPhrase}</span> to confirm
          </FieldLabel>
          <FieldContent>
            <Input
              id="plugin-data-deletion-confirmation"
              autoComplete="off"
              spellCheck={false}
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              placeholder={expectedPhrase}
              disabled={submitting}
            />
            <FieldDescription>
              This binds the confirmation to this exact organization and plugin.
            </FieldDescription>
          </FieldContent>
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!confirmationMatches || submitting}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
          >
            {submitting ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Deleting…
              </>
            ) : (
              "Permanently delete data"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
