"use client";

import { useEffect } from "react";

import {
  BlocksIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  FoldersIcon,
  SearchIcon,
  UserIcon,
  UsersIcon,
  useAnimatedIcon,
} from "@/components/icons/animated";

const ICONS = {
  blocks: BlocksIcon,
  "calendar-check": CalendarCheckIcon,
  "calendar-days": CalendarDaysIcon,
  folders: FoldersIcon,
  search: SearchIcon,
  user: UserIcon,
  users: UsersIcon,
} as const;

export type EmptyStateIconName = keyof typeof ICONS;

/** Long enough for every icon in the set to finish its one pass. */
const SETTLE_MS = 900;

/**
 * The icon inside an `EmptyMedia`. It plays once when the empty state appears
 * and then rests on the static glyph. Icons are picked by name so Server
 * Components can render it. Reduced-motion users get the static glyph.
 */
export function EmptyStateIcon({ name }: { name: EmptyStateIconName }) {
  const { ref } = useAnimatedIcon();
  const Icon = ICONS[name];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const handle = ref.current;
    handle?.startAnimation();
    const settle = window.setTimeout(() => handle?.stopAnimation(), SETTLE_MS);
    return () => window.clearTimeout(settle);
  }, [ref]);

  return <Icon ref={ref} size={24} aria-hidden="true" />;
}
