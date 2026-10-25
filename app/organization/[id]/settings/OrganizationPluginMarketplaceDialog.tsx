"use client";

import { Puzzle, Search, Store } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ItemGroup } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OrganizationPluginAdminSetting } from "@/types";

import {
  type MarketplaceFilter,
  type PluginRowActions,
} from "./organization-plugin-helpers";
import {
  AvailablePluginRow,
  InstalledPluginRow,
} from "./OrganizationPluginRows";

function MarketplaceSectionHeading({
  title,
  description,
  count,
}: {
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="grid gap-0.5">
      <h3 className="text-sm font-medium">
        {title}{" "}
        <span className="text-muted-foreground font-normal tabular-nums">
          ({count})
        </span>
      </h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

/** Browse every plugin: search, filter, install, and manage installed ones. */
export function OrganizationPluginMarketplaceDialog({
  open,
  onOpenChange,
  plugins,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugins: OrganizationPluginAdminSetting[];
  actions: PluginRowActions;
}) {
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] =
    useState<MarketplaceFilter>("all");

  const searchedPlugins = useMemo(() => {
    const term = marketplaceSearch.trim().toLowerCase();

    return plugins.filter((plugin) => {
      if (!term) {
        return true;
      }

      const searchableText = [
        plugin.name,
        plugin.key,
        plugin.navLabel,
        plugin.description ?? "",
        plugin.detailedDescription,
        plugin.ownerName,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(term);
    });
  }, [marketplaceSearch, plugins]);

  const availablePlugins = useMemo(
    () => searchedPlugins.filter((plugin) => !plugin.installed),
    [searchedPlugins],
  );

  const installedPlugins = useMemo(() => {
    const base = searchedPlugins.filter((plugin) => plugin.installed);

    if (marketplaceFilter === "updates") {
      return base.filter(
        (plugin) => plugin.updateAvailable || plugin.forceUpdateRequired,
      );
    }

    return base;
  }, [marketplaceFilter, searchedPlugins]);

  const showAvailableSection =
    marketplaceFilter === "all" || marketplaceFilter === "available";
  const showInstalledSection =
    marketplaceFilter === "all" ||
    marketplaceFilter === "installed" ||
    marketplaceFilter === "updates";

  const visiblePluginCount =
    (showAvailableSection ? availablePlugins.length : 0) +
    (showInstalledSection ? installedPlugins.length : 0);
  const useMarketplaceScroll = visiblePluginCount > 1;

  const marketplaceSections = (
    <>
      {showAvailableSection ? (
        <section className="grid gap-3">
          <MarketplaceSectionHeading
            title="Available to install"
            description="New plugins your organization can activate."
            count={availablePlugins.length}
          />

          {availablePlugins.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Store />
                </EmptyMedia>
                <EmptyTitle>No available plugins in this view</EmptyTitle>
                <EmptyDescription>
                  Try switching filters or clearing the search query.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-3">
              {availablePlugins.map((plugin) => (
                <AvailablePluginRow
                  key={plugin.key}
                  plugin={plugin}
                  actions={actions}
                />
              ))}
            </ItemGroup>
          )}
        </section>
      ) : null}

      {showInstalledSection ? (
        <section className="grid gap-3">
          <MarketplaceSectionHeading
            title="Installed plugins"
            description="Manage active plugins and update settings."
            count={installedPlugins.length}
          />

          {installedPlugins.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Puzzle />
                </EmptyMedia>
                <EmptyTitle>No installed plugins in this view</EmptyTitle>
                <EmptyDescription>
                  Install a plugin to configure and manage it here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-3">
              {installedPlugins.map((plugin) => (
                <InstalledPluginRow
                  key={plugin.key}
                  plugin={plugin}
                  actions={actions}
                />
              ))}
            </ItemGroup>
          )}
        </section>
      ) : null}

      {!showAvailableSection && !showInstalledSection ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>No matching plugins</EmptyTitle>
            <EmptyDescription>
              Try a different search term or filter.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Plugin marketplace</DialogTitle>
          <DialogDescription>
            Search and manage plugins for this organization.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <Field className="w-full lg:flex-1">
              <FieldLabel htmlFor="organization-plugin-search">
                Search plugins
              </FieldLabel>
              <FieldContent>
                <InputGroup>
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="organization-plugin-search"
                    placeholder="Search by name, key, owner, or description"
                    value={marketplaceSearch}
                    onChange={(event) =>
                      setMarketplaceSearch(event.target.value)
                    }
                  />
                </InputGroup>
              </FieldContent>
            </Field>

            <div className="flex min-w-0 flex-col gap-2">
              <FieldTitle>Filter</FieldTitle>
              <ToggleGroup
                value={[marketplaceFilter]}
                onValueChange={(value) => {
                  const nextValue = value[0];
                  if (
                    nextValue === "all" ||
                    nextValue === "installed" ||
                    nextValue === "available" ||
                    nextValue === "updates"
                  ) {
                    setMarketplaceFilter(nextValue);
                  }
                }}
                spacing={2}
                className="flex-wrap"
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="installed">Installed</ToggleGroupItem>
                <ToggleGroupItem value="available">Available</ToggleGroupItem>
                <ToggleGroupItem value="updates">Needs update</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {useMarketplaceScroll ? (
            <ScrollArea className="max-h-120">
              <div className="flex flex-col gap-6">{marketplaceSections}</div>
            </ScrollArea>
          ) : (
            <div className="flex flex-col gap-6">{marketplaceSections}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
