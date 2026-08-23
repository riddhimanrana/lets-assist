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
import { Input } from "@/components/ui/input";
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
  upsertPluginCatalogControl,
  type PluginControlPlaneData,
} from "./actions";

type Props = { data: PluginControlPlaneData; selectedPluginKey: string };
type Plugin = PluginControlPlaneData["plugins"][number];
type FormState = {
  key: string;
  name: string;
  description: string;
  visibility: "global" | "private";
  latestVersion: string;
  forceUpdateVersion: string;
  codeRepository: string;
  codeReference: string;
  isActive: boolean;
  privateCodebase: boolean;
};

function formFromPlugin(plugin?: Plugin): FormState {
  return {
    key: plugin?.key ?? "",
    name: plugin?.name ?? "",
    description: plugin?.description ?? "",
    visibility: plugin?.visibility ?? "private",
    latestVersion: plugin?.latest_version ?? "1.0.0",
    forceUpdateVersion: plugin?.force_update_version ?? "",
    codeRepository: plugin?.code_repository ?? "",
    codeReference: plugin?.code_reference ?? "main",
    isActive: plugin?.is_active ?? true,
    privateCodebase: plugin?.private_codebase ?? true,
  };
}

export default function PluginDetails({ data, selectedPluginKey }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const initial =
    data.plugins.find((plugin) => plugin.key === selectedPluginKey) ??
    data.plugins[0];
  const [form, setForm] = useState(() => formFromPlugin(initial));

  useEffect(() => {
    const plugin = data.plugins.find((row) => row.key === selectedPluginKey);
    if (plugin) setForm(formFromPlugin(plugin));
  }, [data.plugins, selectedPluginKey]);

  const choosePlugin = (key: string | null) => {
    if (!key) return;
    setForm(formFromPlugin(data.plugins.find((plugin) => plugin.key === key)));
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    startTransition(async () => {
      const result = await upsertPluginCatalogControl({
        key: form.key,
        name: form.name,
        description: form.description,
        visibility: form.visibility,
        latestVersion: form.latestVersion,
        forceUpdateVersion: form.forceUpdateVersion || null,
        codeRepository: form.codeRepository || null,
        codeReference: form.codeReference || null,
        isActive: form.isActive,
        privateCodebase: form.privateCodebase,
      });
      if (!result.success) {
        toast.error(result.error || "Plugin details were not saved");
        return;
      }
      toast.success("Plugin details saved");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plugin details</CardTitle>
        <CardDescription>
          Edit identity and release policy. Routine installs and updates happen
          from the overview.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="plugin-details-choice">Plugin</Label>
            <Select value={form.key} onValueChange={choosePlugin}>
              <SelectTrigger id="plugin-details-choice">
                <SelectValue placeholder="Choose plugin" />
              </SelectTrigger>
              <SelectContent>
                {data.plugins.map((plugin) => (
                  <SelectItem key={plugin.key} value={plugin.key}>
                    {plugin.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setForm(formFromPlugin())}
          >
            New plugin draft
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Plugin key">
            <Input
              value={form.key}
              onChange={(event) => update("key", event.target.value)}
            />
          </Field>
          <Field label="Display name">
            <Input
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </Field>
          </div>
          <Field label="Visibility">
            <Select
              value={form.visibility}
              onValueChange={(value) => {
                if (value)
                  update("visibility", value as FormState["visibility"]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="global">Global</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Latest version">
            <Input
              value={form.latestVersion}
              onChange={(event) => update("latestVersion", event.target.value)}
            />
          </Field>
          <Field label="Minimum required version">
            <Input
              placeholder="Optional"
              value={form.forceUpdateVersion}
              onChange={(event) =>
                update("forceUpdateVersion", event.target.value)
              }
            />
          </Field>
          <Field label="Code reference">
            <Input
              value={form.codeReference}
              onChange={(event) => update("codeReference", event.target.value)}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Code repository">
              <Input
                placeholder="github.com/org/repository"
                value={form.codeRepository}
                onChange={(event) =>
                  update("codeRepository", event.target.value)
                }
              />
            </Field>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
          <Toggle
            label="Active in catalog"
            checked={form.isActive}
            onCheckedChange={(checked) => update("isActive", checked)}
          />
          <Toggle
            label="Private codebase"
            checked={form.privateCodebase}
            onCheckedChange={(checked) => update("privateCodebase", checked)}
          />
        </div>
        <Button onClick={save} disabled={isPending || !form.key || !form.name}>
          {isPending ? "Saving…" : "Save plugin details"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
