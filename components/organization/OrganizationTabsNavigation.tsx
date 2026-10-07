"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  OrganizationNavigationBehavior,
  OrganizationTabBehavior,
} from "@/types";
import {
  isNavigationValueActive,
  type OrganizationNavigationDestination,
} from "./organization-navigation-destinations";

type Props = {
  usesFullSectionMobileNav: boolean;
  switcherDestinations: OrganizationNavigationDestination[];
  workspaceDestinations: OrganizationNavigationDestination[];
  utilityDestinations: OrganizationNavigationDestination[];
  activeDestination?: OrganizationNavigationDestination;
  activeDestinationLabel: string;
  sectionGroupLabel: string;
  utilityGroupLabel: string;
  renderSectionSwitcherItem: (
    destination: OrganizationNavigationDestination,
  ) => ReactNode;
  pluginNavigationOverrides: OrganizationNavigationBehavior;
  activePluginParentValue?: string;
  morePluginTabs: OrganizationTabBehavior[];
  hasActiveMoreTab: boolean;
  activeTab: string;
  getTabHref: (value: string) => string;
  fullDocumentTabNavigation: boolean;
};

export function OrganizationTabsNavigation(props: Props) {
  const {
    usesFullSectionMobileNav,
    switcherDestinations,
    workspaceDestinations,
    utilityDestinations,
    activeDestination,
    activeDestinationLabel,
    sectionGroupLabel,
    utilityGroupLabel,
    renderSectionSwitcherItem,
    pluginNavigationOverrides,
    activePluginParentValue,
    morePluginTabs,
    hasActiveMoreTab,
    activeTab,
    getTabHref,
    fullDocumentTabNavigation,
  } = props;

  const activeMoreTab = hasActiveMoreTab;
  const renderNavigationAnchor = (href: string) =>
    fullDocumentTabNavigation ? <a href={href} /> : <Link href={href} />;

  return (
    <div
      className={cn(
        // The tab strip sits straight on the page as an underline row; the
        // hairline belongs to the row so the utility menu shares it.
        "flex min-w-0 items-center gap-2",
        usesFullSectionMobileNav ? "sm:border-b" : "border-b",
        pluginNavigationOverrides.compactHeader ? "mb-3" : "mb-6",
      )}
    >
      {usesFullSectionMobileNav && switcherDestinations.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                // Disclosure trigger, not a navigation item: Base UI supplies the
                // expanded/controls semantics and aria-current stays on the
                // selected menu item.
                aria-label={`${activeDestinationLabel} — change section`}
                data-testid="organization-section-switcher"
                className="w-full min-w-0 justify-between sm:hidden"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {activeDestination?.icon}
                  <span className="truncate">{activeDestinationLabel}</span>
                </span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{sectionGroupLabel}</DropdownMenuLabel>
              {workspaceDestinations.map(renderSectionSwitcherItem)}
            </DropdownMenuGroup>
            {utilityDestinations.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{utilityGroupLabel}</DropdownMenuLabel>
                  {utilityDestinations.map(renderSectionSwitcherItem)}
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <TabsList
        variant="line"
        className={cn(
          "min-w-0 flex-1 gap-0 p-0 group-data-horizontal/tabs:h-10",
          usesFullSectionMobileNav && "hidden sm:flex",
        )}
      >
        {/*
          One trigger per destination, from the same deduplicated list that
          feeds the phone switcher, so the two can never disagree.
        */}
        {workspaceDestinations.map((destination) => {
          const ownsActiveChild = activePluginParentValue === destination.value;

          return (
            <TabsTrigger
              key={destination.value}
              value={destination.value}
              aria-current={ownsActiveChild ? "page" : undefined}
              className={cn(
                "h-10 flex-none shrink-0 gap-2 rounded-none px-3 group-data-[orientation=horizontal]/tabs:after:bottom-0",
                ownsActiveChild && "text-foreground after:opacity-100",
              )}
            >
              {destination.icon ? (
                <span className="hidden sm:contents">{destination.icon}</span>
              ) : null}
              <span className="truncate">{destination.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>

      {morePluginTabs.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={activeMoreTab ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "shrink-0",
                  usesFullSectionMobileNav && "hidden sm:flex",
                )}
              >
                <span>
                  {pluginNavigationOverrides.utilityMenuLabel ?? "More"}
                </span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {pluginNavigationOverrides.utilityMenuLabel ?? "More"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {morePluginTabs.map((pt) => {
                const isActive = isNavigationValueActive(
                  pt.value,
                  activeTab,
                  activePluginParentValue,
                );

                return (
                  <DropdownMenuItem
                    key={pt.value}
                    render={renderNavigationAnchor(getTabHref(pt.value))}
                    aria-current={isActive ? "page" : undefined}
                    className="justify-between"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {pt.icon}
                      <span className="truncate">{pt.label}</span>
                    </span>
                    {isActive ? <Check aria-hidden="true" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
