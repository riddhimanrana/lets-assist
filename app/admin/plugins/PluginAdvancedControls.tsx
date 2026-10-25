"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/SettingsSection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  forceInstallOrganizationPlugin,
  forceUpdateOrganizationPluginInstall,
  setOrganizationPluginInstallStateByAdmin,
  upsertOrganizationPluginInstallConfiguration,
  type PluginControlPlaneData,
} from "./actions";
import { SelectField } from "./PluginSelectField";

type Props = { data: PluginControlPlaneData; selectedPluginKey: string };

export default function PluginAdvancedControls({
  data,
  selectedPluginKey,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [organizationId, setOrganizationId] = useState(
    data.organizations[0]?.id ?? "",
  );
  const [pluginKey, setPluginKey] = useState(
    selectedPluginKey || data.plugins[0]?.key || "",
  );
  const [activateEntitlement, setActivateEntitlement] = useState(true);
  const [configuration, setConfiguration] = useState(
    '{\n  "targeting": {\n    "mode": "any"\n  }\n}',
  );

  useEffect(() => {
    if (selectedPluginKey) setPluginKey(selectedPluginKey);
  }, [selectedPluginKey]);

  const run = (operation: "install" | "update" | "disable") => {
    startTransition(async () => {
      const result =
        operation === "install"
          ? await forceInstallOrganizationPlugin({
              organizationId,
              pluginKey,
              activateEntitlementForPrivate: activateEntitlement,
            })
          : operation === "update"
            ? await forceUpdateOrganizationPluginInstall({
                organizationId,
                pluginKey,
              })
            : await setOrganizationPluginInstallStateByAdmin({
                organizationId,
                pluginKey,
                enabled: false,
              });
      if (!result.success) {
        toast.error(result.error || `${operation} failed`);
        return;
      }
      toast.success(
        operation === "disable"
          ? "Plugin disabled"
          : `Plugin ${operation} complete`,
      );
      router.refresh();
    });
  };

  const saveConfiguration = () => {
    startTransition(async () => {
      const result = await upsertOrganizationPluginInstallConfiguration({
        organizationId,
        pluginKey,
        configurationJson: configuration,
      });
      if (!result.success) {
        toast.error(result.error || "Configuration was not saved");
        return;
      }
      toast.success(result.message || "Configuration saved");
      router.refresh();
    });
  };

  const organizationItems = data.organizations.map((row) => ({
    value: row.id,
    label: row.name,
  }));
  const pluginItems = data.plugins.map((row) => ({
    value: row.key,
    label: row.name,
  }));

  const selectionMissing = isPending || !organizationId || !pluginKey;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <SettingsSection
        title="Install recovery"
        description="Manual controls for support incidents. Use the overview for routine updates."
        footer={
          <>
            <AlertDialog>
              <AlertDialogTrigger
                disabled={selectionMissing}
                render={<Button variant="destructive-ghost" />}
              >
                Disable
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disable this plugin?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The selected organization loses the plugin until it is
                    installed again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => run("disable")}
                  >
                    Disable
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              onClick={() => run("update")}
              disabled={selectionMissing}
            >
              Force update
            </Button>
            <Button onClick={() => run("install")} disabled={selectionMissing}>
              Force install
            </Button>
          </>
        }
      >
        <FieldGroup className="gap-5">
          <SelectField
            label="Organization"
            value={organizationId}
            onChange={setOrganizationId}
            items={organizationItems}
          />
          <SelectField
            label="Plugin"
            value={pluginKey}
            onChange={setPluginKey}
            items={pluginItems}
          />
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="advanced-activate-entitlement">
                Activate private access
              </FieldLabel>
              <FieldDescription>
                Create or reactivate the entitlement during install.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="advanced-activate-entitlement"
              checked={activateEntitlement}
              onCheckedChange={setActivateEntitlement}
            />
          </Field>
        </FieldGroup>
      </SettingsSection>

      <SettingsSection
        title="Install configuration"
        description="JSON settings for the selected organization install. Invalid JSON is rejected."
        footer={
          <Button onClick={saveConfiguration} disabled={selectionMissing}>
            {isPending ? "Saving…" : "Save configuration"}
          </Button>
        }
      >
        <FieldGroup className="gap-5">
          <SelectField
            label="Organization"
            value={organizationId}
            onChange={setOrganizationId}
            items={organizationItems}
          />
          <SelectField
            label="Plugin"
            value={pluginKey}
            onChange={setPluginKey}
            items={pluginItems}
          />
          <Field>
            <FieldLabel htmlFor="advanced-configuration-json">
              Configuration JSON
            </FieldLabel>
            <Textarea
              id="advanced-configuration-json"
              className="min-h-52 font-mono text-xs"
              value={configuration}
              onChange={(event) => setConfiguration(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </SettingsSection>
    </div>
  );
}
