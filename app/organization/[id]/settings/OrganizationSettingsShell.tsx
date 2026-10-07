"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { SectionHeader } from "@/components/layout/PageHeader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  SETTINGS_SECTIONS,
  resolveSettingsSection,
  type SettingsSectionId,
} from "./settings-sections";

/**
 * Settings layout: a section list on the left (a Select on phones) and the
 * active section on the right. The section lives in `?section=` so links,
 * the back button and the Google OAuth return all land on the right place.
 */
export default function OrganizationSettingsShell({
  sections,
}: {
  sections: Record<SettingsSectionId, ReactNode>;
}) {
  const searchParams = useSearchParams();
  const active = resolveSettingsSection(searchParams.get("section"));
  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.value === active) ??
    SETTINGS_SECTIONS[0];

  const openSection = (next: SettingsSectionId) => {
    if (next === active) return;
    // Next.js keeps useSearchParams in sync with pushState, so switching
    // sections needs no server round trip.
    window.history.pushState(null, "", `?section=${next}`);
    window.scrollTo({ top: 0 });
  };

  const handleLinkClick = (
    event: MouseEvent<HTMLAnchorElement>,
    next: SettingsSectionId,
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    openSection(next);
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
      <div className="md:hidden">
        <Select
          items={SETTINGS_SECTIONS}
          value={active}
          onValueChange={(value) => openSection(value as SettingsSectionId)}
        >
          <SelectTrigger className="w-full" aria-label="Settings section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {SETTINGS_SECTIONS.map((section) => (
                <SelectItem key={section.value} value={section.value}>
                  {section.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <nav
        aria-label="Settings sections"
        className="hidden w-44 shrink-0 md:sticky md:top-20 md:block md:self-start"
      >
        <ul className="grid gap-1">
          {SETTINGS_SECTIONS.map((section) => {
            const isActive = section.value === active;
            return (
              <li key={section.value}>
                <Link
                  href={`?section=${section.value}`}
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  onClick={(event) => handleLinkClick(event, section.value)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex h-9 items-center rounded-md px-3 text-sm transition-colors outline-none focus-visible:ring-[3px]",
                    isActive
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section
        key={active}
        aria-labelledby="settings-section-title"
        className="grid min-w-0 flex-1 gap-6"
      >
        <SectionHeader
          title={<span id="settings-section-title">{activeSection.label}</span>}
          description={activeSection.description}
        />
        {sections[active]}
      </section>
    </div>
  );
}
