"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { OrganizationPluginAdminSetting } from "@/types";

import { updateOrganizationPluginConfiguration } from "./actions";
import {
  formatFieldLabel,
  isPlainRecord,
  resolveConfigFieldKind,
  stringifyConfig,
  type ConfigFieldDescriptor,
  type SettingsEditorMode,
} from "./organization-plugin-helpers";

/**
 * State and handlers for the per-plugin configuration editor: which plugin is
 * open, the guided and JSON drafts, and saving them.
 */
export function usePluginSettingsEditor({
  organizationId,
  plugins,
  loadSettings,
}: {
  organizationId: string;
  plugins: OrganizationPluginAdminSetting[];
  loadSettings: () => Promise<void>;
}) {
  const [settingsPluginKey, setSettingsPluginKey] = useState<string | null>(
    null,
  );
  const [settingsEditorMode, setSettingsEditorMode] =
    useState<SettingsEditorMode>("json");
  const [settingsValues, setSettingsValues] = useState<Record<string, unknown>>(
    {},
  );
  const [settingsJson, setSettingsJson] = useState("{}");
  const [settingsSaving, setSettingsSaving] = useState(false);

  const activeSettingsPlugin = useMemo(
    () => plugins.find((plugin) => plugin.key === settingsPluginKey) ?? null,
    [plugins, settingsPluginKey],
  );

  const configFields = useMemo<ConfigFieldDescriptor[]>(() => {
    if (!activeSettingsPlugin?.configSchema) {
      return [];
    }

    const schema = activeSettingsPlugin.configSchema;
    const required = new Set(schema.required ?? []);

    return Object.entries(schema.properties).map(([key, property]) => ({
      key,
      label: property.title ?? formatFieldLabel(key),
      required: required.has(key),
      kind: resolveConfigFieldKind(property),
      property,
    }));
  }, [activeSettingsPlugin]);

  const guidedFields = useMemo(
    () => configFields.filter((field) => field.kind !== "unsupported"),
    [configFields],
  );
  const unsupportedFieldCount = useMemo(
    () => configFields.filter((field) => field.kind === "unsupported").length,
    [configFields],
  );

  useEffect(() => {
    if (settingsPluginKey && settingsEditorMode === "guided") {
      setSettingsJson(stringifyConfig(settingsValues));
    }
  }, [settingsEditorMode, settingsPluginKey, settingsValues]);

  const handleOpenSettingsEditor = (plugin: OrganizationPluginAdminSetting) => {
    if (!plugin.installed) {
      toast.error("Install the plugin before editing its settings");
      return;
    }

    const initialValues = isPlainRecord(plugin.configuration)
      ? plugin.configuration
      : {};

    setSettingsPluginKey(plugin.key);
    setSettingsValues(initialValues);
    setSettingsJson(stringifyConfig(initialValues));
    setSettingsEditorMode(plugin.configSchema ? "guided" : "json");
  };

  const handleCloseSettingsEditor = () => {
    setSettingsPluginKey(null);
    setSettingsValues({});
    setSettingsJson("{}");
    setSettingsEditorMode("json");
    setSettingsSaving(false);
  };

  const handleSettingsValueChange = (key: string, value: unknown) => {
    setSettingsValues((previous) => {
      const next = { ...previous };

      if (value === undefined || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }

      return next;
    });
  };

  const handleSaveSettings = async () => {
    if (!activeSettingsPlugin) {
      return;
    }

    let nextConfiguration: Record<string, unknown>;

    if (settingsEditorMode === "json") {
      const trimmed = settingsJson.trim();

      if (!trimmed) {
        nextConfiguration = {};
      } else {
        try {
          const parsed = JSON.parse(trimmed) as unknown;

          if (!isPlainRecord(parsed)) {
            toast.error("Plugin settings must be a JSON object");
            return;
          }

          nextConfiguration = parsed;
        } catch {
          toast.error("Plugin settings JSON is invalid");
          return;
        }
      }
    } else {
      nextConfiguration = settingsValues;
    }

    setSettingsSaving(true);

    const response = await updateOrganizationPluginConfiguration({
      organizationId,
      pluginKey: activeSettingsPlugin.key,
      configurationJson: JSON.stringify(nextConfiguration),
    });

    if (!response.success) {
      toast.error(response.error || "Failed to save plugin settings");
      setSettingsSaving(false);
      return;
    }

    toast.success(response.message || "Plugin settings saved");
    handleCloseSettingsEditor();
    await loadSettings();
  };

  return {
    activeSettingsPlugin,
    settingsEditorMode,
    setSettingsEditorMode,
    settingsValues,
    settingsJson,
    setSettingsJson,
    settingsSaving,
    guidedFields,
    unsupportedFieldCount,
    handleOpenSettingsEditor,
    handleCloseSettingsEditor,
    handleSettingsValueChange,
    handleSaveSettings,
  };
}

export type PluginSettingsEditor = ReturnType<typeof usePluginSettingsEditor>;
