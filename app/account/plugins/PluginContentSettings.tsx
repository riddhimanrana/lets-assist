"use client";

import { Blocks } from "lucide-react";
import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/layout/SettingsSection";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
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
  // the server rejects the change. Success is silent; the switch is the
  // confirmation.
  const [showAll, setShowAll] = useState(showPluginContent);
  const [hidden, setHidden] = useState(() => new Set(hiddenPluginKeys));
  // One save at a time: each source save rewrites the whole hidden list.
  const [pending, startTransition] = useTransition();

  const saveGlobal = (next: boolean) => {
    const previous = showAll;
    setShowAll(next);
    startTransition(async () => {
      const result = await setPluginContentVisibility(next);
      if ("error" in result) {
        setShowAll(previous);
        toast.error(result.error);
      }
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
      }
    });
  };

  return (
    <>
      <PageHeader
        title="Organization content"
        description="Choose which organization updates appear on your home and dashboard."
      />

      <SettingsSection
        title="Home and dashboard"
        description="These settings do not change your membership or access."
        contentClassName="gap-0 px-0"
        footerHint="Changes save automatically and apply when you reload those pages."
      >
        <Item className="flex-nowrap">
          <ItemContent className="min-w-0">
            <ItemTitle className="line-clamp-none">
              <Label htmlFor="show-plugin-content" className="leading-snug">
                Show organization content on your home and dashboard
              </Label>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Switch
              id="show-plugin-content"
              checked={showAll}
              disabled={pending}
              onCheckedChange={saveGlobal}
              aria-describedby="plugin-content-consequence"
            />
          </ItemActions>
        </Item>

        <ItemSeparator className="my-0" />

        <div className="grid gap-1 px-4 pt-4">
          <h2 className="text-sm font-medium">Sections</h2>
          <p
            id="plugin-content-consequence"
            className="text-muted-foreground text-sm"
          >
            {showAll
              ? "Choose which sections appear."
              : "These stay hidden while the setting above is off."}
          </p>
        </div>

        {sources.length === 0 ? (
          <Empty className="p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Blocks aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Nothing to manage yet</EmptyTitle>
              <EmptyDescription>
                Your organizations have no home or dashboard sections yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0">
            {sources.map((source, index) => {
              const visible = !hidden.has(source.pluginKey);
              // Naming the organization only helps when it says
              // something the plugin name has not already said.
              const sourceLine =
                source.organizationNames.length === 1 &&
                source.organizationNames[0] === source.name
                  ? null
                  : source.organizationNames.join(", ");
              return (
                <Fragment key={source.pluginKey}>
                  {index > 0 ? <ItemSeparator className="my-0" /> : null}
                  <Item className="flex-nowrap">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="line-clamp-none">
                        <Label
                          htmlFor={`plugin-${source.pluginKey}`}
                          className="leading-snug"
                        >
                          {source.name}
                        </Label>
                      </ItemTitle>
                      {sourceLine && (
                        <ItemDescription>From {sourceLine}</ItemDescription>
                      )}
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        id={`plugin-${source.pluginKey}`}
                        checked={showAll && visible}
                        disabled={pending || !showAll}
                        onCheckedChange={(checked) =>
                          saveSource(source, checked)
                        }
                      />
                    </ItemActions>
                  </Item>
                </Fragment>
              );
            })}
          </ItemGroup>
        )}
      </SettingsSection>
    </>
  );
}
