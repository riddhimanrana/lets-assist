"use client";

import { Blocks } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { PlatformPluginSource } from "@/types";

import {
  setPluginContentVisibility,
  setPluginSourceVisibility,
} from "./actions";

interface PluginContentSettingsProps {
  showPluginContent: boolean;
  hiddenPluginKeys: string[];
  sources: PlatformPluginSource[];
}

export function PluginContentSettings({
  showPluginContent,
  hiddenPluginKeys,
  sources,
}: PluginContentSettingsProps) {
  // Optimistic local state: the switch moves on click and rolls back only if
  // the server rejects the change.
  const [showAll, setShowAll] = useState(showPluginContent);
  const [hidden, setHidden] = useState(() => new Set(hiddenPluginKeys));
  const [pending, startTransition] = useTransition();

  const saveGlobal = (next: boolean) => {
    const previous = showAll;
    setShowAll(next);
    startTransition(async () => {
      const result = await setPluginContentVisibility(next);
      if ("error" in result) {
        setShowAll(previous);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Plugin content is on" : "Plugin content is off");
    });
  };

  const saveSource = (source: PlatformPluginSource, next: boolean) => {
    const previous = new Set(hidden);
    setHidden((current) => {
      const updated = new Set(current);
      if (next) updated.delete(source.pluginKey);
      else updated.add(source.pluginKey);
      return updated;
    });
    startTransition(async () => {
      const result = await setPluginSourceVisibility(source.pluginKey, next);
      if ("error" in result) {
        setHidden(previous);
        toast.error(result.error);
        return;
      }
      toast.success(
        next ? `${source.name} is showing` : `${source.name} is hidden`,
      );
    });
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Plugin content
          </h1>
          <p className="text-muted-foreground mt-1">
            Choose whether content from your organizations&apos; plugins appears
            on your home page and dashboard
          </p>
        </div>

        <Card className="border shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">
              Where plugin content shows
            </CardTitle>
            <CardDescription>
              This only changes what you see. It never changes your membership
              or what your organizations can do.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start justify-between gap-4 rounded-md border p-4">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="show-plugin-content" className="text-base">
                  Show plugin content on your home and dashboard
                </Label>
                <p className="text-sm text-muted-foreground">
                  Turn this off and neither surface shows anything from a
                  plugin.
                </p>
              </div>
              <Switch
                id="show-plugin-content"
                className="shrink-0"
                checked={showAll}
                disabled={pending}
                onCheckedChange={saveGlobal}
                aria-describedby="plugin-content-consequence"
              />
            </div>

            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-medium">Plugins you can see</h2>
                <p
                  id="plugin-content-consequence"
                  className="text-sm text-muted-foreground"
                >
                  {showAll
                    ? "Hide a single plugin to keep the rest."
                    : "These stay hidden while the setting above is off."}
                </p>
              </div>

              {sources.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
                  <Blocks
                    className="h-5 w-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium">Nothing to manage yet</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    None of your organizations use a plugin that adds content to
                    your home page or dashboard.
                  </p>
                </div>
              ) : (
                <div className="divide-y rounded-md border">
                  {sources.map((source) => {
                    const visible = !hidden.has(source.pluginKey);
                    // Naming the organization only helps when it says
                    // something the plugin name has not already said.
                    const sourceLine =
                      source.organizationNames.length === 1 &&
                      source.organizationNames[0] === source.name
                        ? null
                        : source.organizationNames.join(", ");
                    return (
                      <div
                        key={source.pluginKey}
                        className="flex items-start justify-between gap-4 p-4"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <Label
                            htmlFor={`plugin-${source.pluginKey}`}
                            className="text-base"
                          >
                            {source.name}
                          </Label>
                          {source.description && (
                            <p className="text-sm text-muted-foreground">
                              {source.description}
                            </p>
                          )}
                          {sourceLine && (
                            <p className="text-sm text-muted-foreground">
                              From {sourceLine}
                            </p>
                          )}
                        </div>
                        <Switch
                          id={`plugin-${source.pluginKey}`}
                          className="shrink-0"
                          checked={showAll && visible}
                          disabled={pending || !showAll}
                          onCheckedChange={(checked) =>
                            saveSource(source, checked)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />
            <p className="text-sm text-muted-foreground">
              Changes save on their own and apply the next time your home page
              or dashboard loads.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
