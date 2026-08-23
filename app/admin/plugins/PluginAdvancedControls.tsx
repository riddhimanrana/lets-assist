"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  forceInstallOrganizationPlugin,
  forceUpdateOrganizationPluginInstall,
  setOrganizationPluginInstallStateByAdmin,
  upsertOrganizationPluginInstallConfiguration,
  type PluginControlPlaneData,
} from "./actions";

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

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Install recovery</CardTitle>
          <CardDescription>
            Manual controls for support incidents. Use the overview for routine
            updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label>Activate private access</Label>
              <p className="text-xs text-muted-foreground">
                Create or reactivate the entitlement during install.
              </p>
            </div>
            <Switch
              checked={activateEntitlement}
              onCheckedChange={setActivateEntitlement}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => run("install")}
              disabled={isPending || !organizationId || !pluginKey}
            >
              Force install
            </Button>
            <Button
              variant="outline"
              onClick={() => run("update")}
              disabled={isPending || !organizationId || !pluginKey}
            >
              Force update
            </Button>
            <Button
              variant="destructive"
              onClick={() => run("disable")}
              disabled={isPending || !organizationId || !pluginKey}
            >
              Disable
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Install configuration</CardTitle>
          <CardDescription>
            JSON settings for the selected organization install. Invalid JSON is
            rejected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <div className="space-y-2">
            <Label>Configuration JSON</Label>
            <Textarea
              className="min-h-52 font-mono text-xs"
              value={configuration}
              onChange={(event) => setConfiguration(event.target.value)}
            />
          </div>
          <Button
            onClick={saveConfiguration}
            disabled={isPending || !organizationId || !pluginKey}
          >
            {isPending ? "Saving…" : "Save configuration"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger>
          <SelectValue placeholder={`Choose ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
