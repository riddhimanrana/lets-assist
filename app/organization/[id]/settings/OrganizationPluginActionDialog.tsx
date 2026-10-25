"use client";

import { AlertTriangle, Check, Info, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { describePluginUninstallImpact } from "@/lib/plugins/plugin-uninstall-impact";

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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

import {
  formatOwnerTypeLabel,
  formatScopeLabel,
  type PluginActionConfirmation,
} from "./organization-plugin-helpers";

/**
 * Confirms installing or uninstalling a plugin. Installing lists the access the
 * plugin requests and needs explicit consent; uninstalling spells out what is
 * removed and what data is retained.
 */
export function OrganizationPluginActionDialog({
  confirmation,
  installConsentChecked,
  onInstallConsentChange,
  submitting,
  onClose,
  onConfirm,
}: {
  confirmation: PluginActionConfirmation;
  installConsentChecked: boolean;
  onInstallConsentChange: (checked: boolean) => void;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const activePluginAction = confirmation?.plugin ?? null;
  const isInstallAction = confirmation?.intent === "install";

  const uninstallImpact = useMemo(() => {
    if (!activePluginAction || isInstallAction) {
      return null;
    }
    return describePluginUninstallImpact({
      pluginName: activePluginAction.name,
      dataAccessPurposes: activePluginAction.dataAccessPurposes,
      permanentDeletionAvailable: activePluginAction.dataDeletionAvailable,
    });
  }, [activePluginAction, isInstallAction]);

  return (
    <AlertDialog
      open={Boolean(confirmation)}
      onOpenChange={(open: boolean) => {
        if (!open && !submitting) {
          onClose();
        }
      }}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-md"
        aria-describedby={
          !isInstallAction
            ? "plugin-action-desc plugin-uninstall-retention-clause"
            : "plugin-action-desc"
        }
      >
        {activePluginAction ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isInstallAction
                  ? `Install ${activePluginAction.name}?`
                  : `Uninstall ${activePluginAction.name}?`}
              </AlertDialogTitle>
              <AlertDialogDescription id="plugin-action-desc">
                {isInstallAction
                  ? `Are you sure you want to add this plugin to your organization?`
                  : "This removes the install record and saved settings immediately. Uninstall runs no plugin code and deletes no plugin data — see the retention note below."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {isInstallAction ? (
              <div className="grid gap-4">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {activePluginAction.name}
                    </span>
                    <Badge variant="secondary">
                      {formatOwnerTypeLabel(activePluginAction.ownerType)}
                    </Badge>
                  </div>
                  <span className="text-muted-foreground text-sm">
                    by {activePluginAction.ownerName} &middot; v
                    {activePluginAction.version}
                  </span>
                  <p className="text-muted-foreground text-sm">
                    {activePluginAction.detailedDescription}
                  </p>
                </div>

                <div className="grid max-h-64 gap-3 overflow-y-auto rounded-md border p-3">
                  <p className="text-sm font-medium">
                    This plugin requests access to:
                  </p>
                  <ul className="grid gap-2">
                    {activePluginAction.requiredScopes.length > 0 ||
                    activePluginAction.dataAccess.length > 0 ? (
                      <>
                        {activePluginAction.requiredScopes.map((scope) => (
                          <li
                            key={`${activePluginAction.key}-scope-${scope}`}
                            className="flex items-start gap-2 text-sm"
                          >
                            <Check className="text-primary mt-0.5 size-4 shrink-0" />
                            <span>{formatScopeLabel(scope)}</span>
                          </li>
                        ))}
                        {activePluginAction.dataAccess.map((entry) => (
                          <li
                            key={`${activePluginAction.key}-data-${entry}`}
                            className="flex items-start gap-2 text-sm"
                          >
                            <Check className="text-primary mt-0.5 size-4 shrink-0" />
                            <span>{entry}</span>
                          </li>
                        ))}
                      </>
                    ) : (
                      <li className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Info className="size-4 shrink-0" />
                        <span>No additional data access required.</span>
                      </li>
                    )}
                  </ul>
                </div>

                <label className="flex min-h-9 cursor-pointer items-center gap-3">
                  <Checkbox
                    checked={installConsentChecked}
                    onCheckedChange={(checked) =>
                      onInstallConsentChange(checked === true)
                    }
                  />
                  <span className="text-sm font-medium">
                    I approve installing this plugin and grant the requested
                    access.
                  </span>
                </label>
              </div>
            ) : (
              <Alert
                variant="destructive"
                role="group"
                aria-label="Data handling information"
              >
                <AlertTriangle />
                <AlertTitle>
                  {
                    "Plugin surfaces are disabled immediately and saved settings permanently removed. This cannot be undone; already-queued work may still complete."
                  }
                </AlertTitle>
                {uninstallImpact ? (
                  <AlertDescription className="grid gap-2">
                    <p id="plugin-uninstall-retention-clause">
                      {uninstallImpact.retentionClause}
                    </p>
                    {uninstallImpact.dataCategories.length > 0 ? (
                      <div
                        tabIndex={0}
                        role="group"
                        aria-label="Declared data categories"
                        className="grid max-h-32 gap-1.5 overflow-y-auto rounded-md border p-3"
                      >
                        <p
                          aria-hidden="true"
                          className="text-foreground text-sm font-medium"
                        >
                          Declared data categories
                        </p>
                        <ul className="grid gap-1">
                          {uninstallImpact.dataCategories.map((category) => (
                            <li
                              key={category}
                              className="text-foreground text-sm"
                            >
                              {category}
                            </li>
                          ))}
                        </ul>
                        {uninstallImpact.additionalDataCategoryCount > 0 ? (
                          <p className="text-muted-foreground text-sm">
                            +{uninstallImpact.additionalDataCategoryCount} more
                            categor
                            {uninstallImpact.additionalDataCategoryCount === 1
                              ? "y"
                              : "ies"}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </AlertDescription>
                ) : null}
              </Alert>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant={isInstallAction ? "default" : "destructive"}
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
                disabled={
                  submitting ||
                  (isInstallAction && !installConsentChecked) ||
                  (!isInstallAction && activePluginAction?.isForced)
                }
              >
                {submitting ? (
                  <>
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                    {isInstallAction ? "Installing…" : "Removing…"}
                  </>
                ) : isInstallAction ? (
                  "Install plugin"
                ) : activePluginAction?.isForced ? (
                  "Cannot uninstall forced plugin"
                ) : (
                  "Yes, uninstall"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
