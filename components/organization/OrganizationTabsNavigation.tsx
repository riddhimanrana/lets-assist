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
  /** The utility entry that is open, directly or as the parent of a child. */
  activeMoreTab?: OrganizationTabBehavior;
  activeTab: string;
  getTabHref: (value: string) => string;
  fullDocumentTabNavigation: boolean;
};

/** Shared by the line tabs and the More trigger so their underlines align. */
const LINE_ITEM_CLASS = "h-10 shrink-0 rounded-none focus-visible:ring-inset";
const LINE_ACTIVE_CLASS =
  "text-foreground dark:text-foreground after:opacity-100";

/**
 * Page navigation for one organization. Every organization gets the same
 * treatment: line tabs with a More menu from tablet width up, and one section
 * switcher on phones that lists every permitted destination.
 */
export function OrganizationTabsNavigation(props: Props) {
  const {
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
    activeMoreTab,
    activeTab,
    getTabHref,
    fullDocumentTabNavigation,
  } = props;

  const renderNavigationAnchor = (href: string) =>
    fullDocumentTabNavigation ? <a href={href} /> : <Link href={href} />;

  // A single destination needs no switcher; its tab stays visible instead.
  const usesPhoneSwitcher = switcherDestinations.length > 1;
  const moreLabel = pluginNavigationOverrides.utilityMenuLabel ?? "More";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        // The hairline belongs to the row, so the More trigger shares it. On
        // phones the switcher replaces the strip and needs no hairline.
        usesPhoneSwitcher ? "sm:border-b" : "border-b",
        pluginNavigationOverrides.compactHeader ? "mb-4" : "mb-6",
      )}
    >
      {usesPhoneSwitcher ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                // Disclosure trigger, not a navigation item: Base UI supplies the
                // expanded/controls semantics and aria-current stays on the
                // selected menu item.
                aria-label={`${activeDestinationLabel}, change section`}
                data-testid="organization-section-switcher"
                // Phone only, so it gets a 44px touch target.
                className="h-11 w-full min-w-0 justify-between sm:hidden"
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
          usesPhoneSwitcher && "hidden sm:flex",
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
                "flex-none gap-2 px-3 group-data-[orientation=horizontal]/tabs:after:bottom-0",
                // The focus ring is inset because the strip scrolls sideways
                // and would clip an outer ring.
                LINE_ITEM_CLASS,
                // A child route keeps its parent tab underlined like the
                // active tab.
                ownsActiveChild && LINE_ACTIVE_CLASS,
              )}
            >
              {destination.icon ? (
                <span className="hidden sm:contents">{destination.icon}</span>
              ) : null}
              {destination.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {morePluginTabs.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                data-active={activeMoreTab ? "" : undefined}
                className={cn(
                  "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative max-w-56 px-3 hover:bg-transparent",
                  "after:bg-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:opacity-0 after:transition-opacity",
                  LINE_ITEM_CLASS,
                  activeMoreTab && LINE_ACTIVE_CLASS,
                  usesPhoneSwitcher && "hidden sm:inline-flex",
                )}
              >
                {activeMoreTab ? (
                  // The closed menu names the open utility page, so a page
                  // such as Meetings never disappears from the strip.
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="sr-only">{moreLabel}: </span>
                    {activeMoreTab.icon}
                    <span className="truncate">{activeMoreTab.label}</span>
                  </span>
                ) : (
                  <span>{moreLabel}</span>
                )}
                <ChevronDown data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{moreLabel}</DropdownMenuLabel>
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
