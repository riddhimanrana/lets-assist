"use client";

import { Loader2, Settings2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  decodeEnumValue,
  encodeEnumValue,
  formatLastUpdated,
  formatOwnerTypeLabel,
} from "./organization-plugin-helpers";
import type { PluginSettingsEditor } from "./usePluginSettingsEditor";

/** The per-plugin configuration editor, guided where a schema exists. */
export function OrganizationPluginConfigDialog({
  editor,
}: {
  editor: PluginSettingsEditor;
}) {
  const {
    activeSettingsPlugin,
    settingsEditorMode,
    setSettingsEditorMode,
    settingsValues,
    settingsJson,
    setSettingsJson,
    settingsSaving,
    guidedFields,
    unsupportedFieldCount,
    handleCloseSettingsEditor,
    handleSettingsValueChange,
    handleSaveSettings,
  } = editor;

  return (
    <Dialog
      open={Boolean(activeSettingsPlugin)}
      onOpenChange={(open) => {
        if (!open) {
          handleCloseSettingsEditor();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {activeSettingsPlugin
              ? `${activeSettingsPlugin.name} settings`
              : "Plugin settings"}
          </DialogTitle>
          <DialogDescription>
            Configure this plugin for your organization. Changes apply only to
            your organization.
          </DialogDescription>
        </DialogHeader>

        {activeSettingsPlugin ? (
          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
              Plugin key{" "}
              <span className="font-mono">{activeSettingsPlugin.key}</span> ·
              Owner: {activeSettingsPlugin.ownerName} ·{" "}
              {formatOwnerTypeLabel(activeSettingsPlugin.ownerType)} · Last
              updated {formatLastUpdated(activeSettingsPlugin.lastUpdatedAt)}
            </p>

            {activeSettingsPlugin.configSchema ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <FieldTitle>Editor mode</FieldTitle>
                  <ToggleGroup
                    value={[settingsEditorMode]}
                    onValueChange={(value) => {
                      const nextValue = value[0];
                      if (nextValue === "guided" || nextValue === "json") {
                        setSettingsEditorMode(nextValue);
                      }
                    }}
                    spacing={2}
                  >
                    <ToggleGroupItem value="guided">Guided</ToggleGroupItem>
                    <ToggleGroupItem value="json">JSON</ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {settingsEditorMode === "guided" ? (
                  <>
                    <FieldGroup>
                      {guidedFields.map((field) => {
                        const rawValue =
                          settingsValues[field.key] ?? field.property.default;

                        if (field.kind === "boolean") {
                          return (
                            <Field key={field.key} orientation="horizontal">
                              <Switch
                                id={`plugin-setting-${field.key}`}
                                checked={Boolean(rawValue)}
                                onCheckedChange={(checked) =>
                                  handleSettingsValueChange(field.key, checked)
                                }
                              />
                              <FieldContent>
                                <FieldLabel
                                  htmlFor={`plugin-setting-${field.key}`}
                                >
                                  {field.label}
                                </FieldLabel>
                                {field.property.description ? (
                                  <FieldDescription>
                                    {field.property.description}
                                  </FieldDescription>
                                ) : null}
                              </FieldContent>
                            </Field>
                          );
                        }

                        if (field.kind === "enum") {
                          const enumValues = field.property.enum ?? [];
                          const encodedValues = enumValues.map((value) =>
                            encodeEnumValue(value),
                          );
                          const encodedCurrent =
                            rawValue === undefined
                              ? "__default__"
                              : encodeEnumValue(rawValue);
                          const selectedValue = encodedValues.includes(
                            encodedCurrent,
                          )
                            ? encodedCurrent
                            : "__default__";

                          return (
                            <Field key={field.key}>
                              <FieldLabel
                                htmlFor={`plugin-setting-${field.key}`}
                              >
                                {field.label}
                                {field.required ? " *" : ""}
                              </FieldLabel>
                              <FieldContent>
                                <NativeSelect
                                  id={`plugin-setting-${field.key}`}
                                  value={selectedValue}
                                  onChange={(event) => {
                                    const selected = event.target.value;
                                    if (selected === "__default__") {
                                      handleSettingsValueChange(
                                        field.key,
                                        undefined,
                                      );
                                      return;
                                    }

                                    handleSettingsValueChange(
                                      field.key,
                                      decodeEnumValue(selected),
                                    );
                                  }}
                                >
                                  <NativeSelectOption value="__default__">
                                    Use plugin default
                                  </NativeSelectOption>
                                  {enumValues.map((option, index) => {
                                    const encoded = encodeEnumValue(option);
                                    return (
                                      <NativeSelectOption
                                        key={`${field.key}-${index}`}
                                        value={encoded}
                                      >
                                        {String(option)}
                                      </NativeSelectOption>
                                    );
                                  })}
                                </NativeSelect>
                                {field.property.description ? (
                                  <FieldDescription>
                                    {field.property.description}
                                  </FieldDescription>
                                ) : null}
                              </FieldContent>
                            </Field>
                          );
                        }

                        if (field.kind === "number") {
                          return (
                            <Field key={field.key}>
                              <FieldLabel
                                htmlFor={`plugin-setting-${field.key}`}
                              >
                                {field.label}
                                {field.required ? " *" : ""}
                              </FieldLabel>
                              <FieldContent>
                                <Input
                                  id={`plugin-setting-${field.key}`}
                                  type="number"
                                  value={
                                    rawValue === undefined || rawValue === null
                                      ? ""
                                      : String(rawValue)
                                  }
                                  onChange={(event) => {
                                    const nextValue = event.target.value.trim();
                                    if (!nextValue) {
                                      handleSettingsValueChange(
                                        field.key,
                                        undefined,
                                      );
                                      return;
                                    }

                                    const parsedNumber =
                                      field.property.type === "integer"
                                        ? Number.parseInt(nextValue, 10)
                                        : Number.parseFloat(nextValue);

                                    if (!Number.isNaN(parsedNumber)) {
                                      handleSettingsValueChange(
                                        field.key,
                                        parsedNumber,
                                      );
                                    }
                                  }}
                                />
                                {field.property.description ? (
                                  <FieldDescription>
                                    {field.property.description}
                                  </FieldDescription>
                                ) : null}
                              </FieldContent>
                            </Field>
                          );
                        }

                        if (field.kind === "textarea") {
                          return (
                            <Field key={field.key}>
                              <FieldLabel
                                htmlFor={`plugin-setting-${field.key}`}
                              >
                                {field.label}
                                {field.required ? " *" : ""}
                              </FieldLabel>
                              <FieldContent>
                                <Textarea
                                  id={`plugin-setting-${field.key}`}
                                  value={
                                    typeof rawValue === "string" ? rawValue : ""
                                  }
                                  onChange={(event) =>
                                    handleSettingsValueChange(
                                      field.key,
                                      event.target.value,
                                    )
                                  }
                                  className="min-h-28"
                                />
                                {field.property.description ? (
                                  <FieldDescription>
                                    {field.property.description}
                                  </FieldDescription>
                                ) : null}
                              </FieldContent>
                            </Field>
                          );
                        }

                        return (
                          <Field key={field.key}>
                            <FieldLabel htmlFor={`plugin-setting-${field.key}`}>
                              {field.label}
                              {field.required ? " *" : ""}
                            </FieldLabel>
                            <FieldContent>
                              <Input
                                id={`plugin-setting-${field.key}`}
                                value={
                                  typeof rawValue === "string" ? rawValue : ""
                                }
                                onChange={(event) =>
                                  handleSettingsValueChange(
                                    field.key,
                                    event.target.value,
                                  )
                                }
                              />
                              {field.property.description ? (
                                <FieldDescription>
                                  {field.property.description}
                                </FieldDescription>
                              ) : null}
                            </FieldContent>
                          </Field>
                        );
                      })}
                    </FieldGroup>

                    {guidedFields.length === 0 ? (
                      <Alert>
                        <AlertTitle>No guided fields detected</AlertTitle>
                        <AlertDescription>
                          This plugin currently needs JSON mode for
                          configuration.
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {unsupportedFieldCount > 0 ? (
                      <Alert>
                        <AlertTitle>Some fields require JSON mode</AlertTitle>
                        <AlertDescription>
                          {unsupportedFieldCount} advanced field
                          {unsupportedFieldCount === 1 ? "" : "s"} can only be
                          edited in JSON mode.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </>
                ) : (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="plugin-settings-json">
                        Settings JSON
                      </FieldLabel>
                      <FieldContent>
                        <Textarea
                          id="plugin-settings-json"
                          className="min-h-56 font-mono text-sm"
                          value={settingsJson}
                          onChange={(event) =>
                            setSettingsJson(event.target.value)
                          }
                        />
                        <FieldDescription>
                          Use JSON mode for advanced fields and nested objects.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldGroup>
                )}
              </div>
            ) : (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="plugin-settings-json">
                    Settings JSON
                  </FieldLabel>
                  <FieldContent>
                    <Textarea
                      id="plugin-settings-json"
                      className="min-h-56 font-mono text-sm"
                      value={settingsJson}
                      onChange={(event) => setSettingsJson(event.target.value)}
                    />
                    <FieldDescription>
                      This plugin does not expose a guided schema yet, so JSON
                      mode is used.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldGroup>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseSettingsEditor}
                disabled={settingsSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSaveSettings}
                disabled={settingsSaving}
              >
                {settingsSaving ? (
                  <>
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                    Saving…
                  </>
                ) : (
                  <>
                    <Settings2 data-icon="inline-start" />
                    Save settings
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
