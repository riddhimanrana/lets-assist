"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
    <SettingsSection
      title="Plugin details"
      description="Edit identity and release policy. Routine installs and updates happen from the overview."
      footer={
        <Button onClick={save} disabled={isPending || !form.key || !form.name}>
          {isPending ? "Saving…" : "Save plugin details"}
        </Button>
      }
    >
      <FieldGroup className="gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="plugin-details-choice">Plugin</FieldLabel>
            <Select value={form.key} onValueChange={choosePlugin}>
              <SelectTrigger id="plugin-details-choice" className="w-full">
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
          </Field>
          <Button
            type="button"
            variant="outline"
            onClick={() => setForm(formFromPlugin())}
          >
            New plugin draft
          </Button>
        </div>

        <FieldSeparator />

        <div className="grid gap-5 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="plugin-key">Plugin key</FieldLabel>
            <Input
              id="plugin-key"
              value={form.key}
              onChange={(event) => update("key", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="plugin-name">Display name</FieldLabel>
            <Input
              id="plugin-name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel htmlFor="plugin-description">Description</FieldLabel>
            <Textarea
              id="plugin-description"
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="plugin-visibility">Visibility</FieldLabel>
            <Select
              value={form.visibility}
              onValueChange={(value) => {
                if (value)
                  update("visibility", value as FormState["visibility"]);
              }}
            >
              <SelectTrigger id="plugin-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="global">Global</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="plugin-latest-version">
              Latest version
            </FieldLabel>
            <Input
              id="plugin-latest-version"
              value={form.latestVersion}
              onChange={(event) => update("latestVersion", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="plugin-force-version">
              Minimum required version
            </FieldLabel>
            <Input
              id="plugin-force-version"
              placeholder="Optional"
              value={form.forceUpdateVersion}
              onChange={(event) =>
                update("forceUpdateVersion", event.target.value)
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="plugin-code-reference">
              Code reference
            </FieldLabel>
            <Input
              id="plugin-code-reference"
              value={form.codeReference}
              onChange={(event) => update("codeReference", event.target.value)}
            />
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel htmlFor="plugin-code-repository">
              Code repository
            </FieldLabel>
            <Input
              id="plugin-code-repository"
              placeholder="github.com/org/repository"
              value={form.codeRepository}
              onChange={(event) => update("codeRepository", event.target.value)}
            />
          </Field>
        </div>

        <FieldSeparator />

        <div className="grid gap-4 md:grid-cols-2 md:gap-x-8">
          <Field orientation="horizontal">
            <FieldLabel htmlFor="plugin-is-active">
              Active in catalog
            </FieldLabel>
            <Switch
              id="plugin-is-active"
              checked={form.isActive}
              onCheckedChange={(checked) => update("isActive", checked)}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="plugin-private-codebase">
              Private codebase
            </FieldLabel>
            <Switch
              id="plugin-private-codebase"
              checked={form.privateCodebase}
              onCheckedChange={(checked) => update("privateCodebase", checked)}
            />
          </Field>
        </div>
      </FieldGroup>
    </SettingsSection>
  );
}
