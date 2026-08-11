import "server-only";

import { toOrganizationPluginAccessRole } from "@/lib/plugins/access-role";
import {
  loadAccessibleOrganizationPluginAccess,
  type PluginAccessQueryClient,
} from "@/lib/plugins/organization-plugin-access";
import {
  isPluginHidden,
  loadPluginDisplayPreferences,
} from "@/lib/plugins/plugin-display-preferences";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { hasSurfaceAccess } from "@/lib/plugins/resolve-plugin-surfaces";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  OrganizationPluginAccessRole,
  OrganizationPluginDefinition,
  PlatformDashboardCard,
  PlatformDashboardCardStat,
  PlatformFeedItem,
  PlatformPluginSource,
  PlatformPluginSurface,
  PlatformSurfaceContext,
} from "@/types";

const DEFAULT_FEED_LIMIT = 5;
const MAX_FEED_LIMIT = 10;
const MAX_TOTAL_FEED_ITEMS = 10;
const MAX_CARD_STATS = 3;
const PLUGIN_RESOLVE_TIMEOUT_MS = 1500;

const FEED_TITLE_MAX = 120;
const FEED_SUMMARY_MAX = 240;
const FEED_BADGE_MAX = 40;
const CARD_TEXT_MAX = 60;

const FEED_ITEM_KINDS = new Set(["post", "event"]);
const CARD_STATUS_TONES = new Set(["positive", "warning", "neutral"]);

export interface ResolvePlatformFeedItemsOptions {
  limit?: number;
  /** Per-plugin resolver budget; overridable for tests only. */
  timeoutMs?: number;
}

export interface ResolvePlatformDashboardCardsOptions {
  /** Per-plugin resolver budget; overridable for tests only. */
  timeoutMs?: number;
}

type PlatformPluginMembership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  role: OrganizationPluginAccessRole;
};

type PlatformPluginContribution = {
  plugin: OrganizationPluginDefinition;
  context: PlatformSurfaceContext;
};

/** One installed plugin the viewer is entitled to see on a platform surface. */
type EligiblePlatformPlugin = {
  plugin: OrganizationPluginDefinition;
  membership: PlatformPluginMembership;
  configuration: Record<string, unknown> | null;
};

const PLATFORM_SURFACES: readonly PlatformPluginSurface[] = [
  "platform.home.feed",
  "platform.dashboard.card",
];

/**
 * Declaring a surface is not enough — a plugin that never implements the
 * resolver contributes nothing, so it is neither resolved nor offered as
 * something the viewer can switch off.
 */
const SURFACE_IMPLEMENTATIONS: Record<
  PlatformPluginSurface,
  (plugin: OrganizationPluginDefinition) => boolean
> = {
  "platform.home.feed": (plugin) =>
    typeof plugin.resolvePlatformFeedItems === "function",
  "platform.dashboard.card": (plugin) =>
    typeof plugin.resolvePlatformDashboardCard === "function",
};

type MembershipOrganizationRow = {
  id: string;
  name: string | null;
  username: string | null;
};

type MembershipRow = {
  organization_id: string;
  role: string | null;
  organization: MembershipOrganizationRow | MembershipOrganizationRow[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadActiveMemberships(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<PlatformPluginMembership[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "organization_id, role, organization:organizations(id, name, username)",
    )
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    console.warn(
      "[platform-surfaces] Failed to load organization memberships:",
      error,
    );
    return [];
  }

  const memberships: PlatformPluginMembership[] = [];
  for (const row of (data ?? []) as MembershipRow[]) {
    const role = toOrganizationPluginAccessRole(row.role);
    if (!role || !row.organization_id) continue;
    const organization = Array.isArray(row.organization)
      ? row.organization[0]
      : row.organization;
    memberships.push({
      organizationId: row.organization_id,
      organizationName: organization?.name ?? "Organization",
      organizationSlug: organization?.username ?? null,
      role,
    });
  }
  return memberships;
}

/**
 * Every plugin the viewer is entitled to see on at least one of `surfaces`.
 * Preference-agnostic on purpose: the account setting needs the full list so a
 * hidden plugin can be switched back on.
 */
async function loadEligiblePlatformPlugins(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  surfaces: readonly PlatformPluginSurface[];
}): Promise<EligiblePlatformPlugin[]> {
  const { supabase } = input;
  const memberships = await loadActiveMemberships(supabase, input.userId);
  if (memberships.length === 0) return [];

  // The consolidated access read model needs entitlement rows, which RLS
  // hides from plain members; follow resolveOrganizationPluginExperiences and
  // read it with the admin client (memberships above stay viewer-scoped).
  let accessClient: PluginAccessQueryClient;
  try {
    accessClient = getAdminClient();
  } catch {
    accessClient = supabase;
  }

  const installRows = await loadAccessibleOrganizationPluginAccess({
    supabase: accessClient,
    organizationIds: memberships.map((membership) => membership.organizationId),
  });

  const membershipByOrganization = new Map(
    memberships.map((membership) => [membership.organizationId, membership]),
  );

  const eligible: EligiblePlatformPlugin[] = [];
  for (const install of installRows) {
    const membership = membershipByOrganization.get(install.organization_id);
    if (!membership) continue;

    const plugin = getRegisteredPlugin(install.plugin_key);
    if (!plugin) continue;

    const servesASurface = input.surfaces.some((surface) => {
      const surfaceAccess = plugin.manifest.platformSurfaces?.[surface];
      if (!surfaceAccess) return false;
      if (!hasSurfaceAccess(surfaceAccess, membership.role)) return false;
      return SURFACE_IMPLEMENTATIONS[surface](plugin);
    });
    if (!servesASurface) continue;

    eligible.push({
      plugin,
      membership,
      configuration: isRecord(install.configuration)
        ? install.configuration
        : null,
    });
  }
  return eligible;
}

/**
 * Contributions for one surface, with the viewer's display preference already
 * applied. The preference is read first and a hidden plugin never reaches this
 * list, so its resolver is never invoked — the cheapest way to honour the
 * setting is also the correct one.
 */
async function loadPlatformSurfaceContributions(input: {
  userId: string;
  surface: PlatformPluginSurface;
  limit: number;
}): Promise<PlatformPluginContribution[]> {
  const supabase = await createClient();

  const preferences = await loadPluginDisplayPreferences(
    supabase,
    input.userId,
  );
  if (!preferences.showPluginContent) return [];

  const eligible = await loadEligiblePlatformPlugins({
    supabase,
    userId: input.userId,
    surfaces: [input.surface],
  });

  return eligible
    .filter((entry) => !isPluginHidden(preferences, entry.plugin.manifest.key))
    .map(({ plugin, membership, configuration }) => ({
      plugin,
      context: {
        organizationId: membership.organizationId,
        organizationName: membership.organizationName,
        organizationSlug: membership.organizationSlug,
        userId: input.userId,
        viewerRole: membership.role,
        pluginConfiguration: configuration,
        limit: input.limit,
      },
    }));
}

/**
 * The plugins whose platform content the viewer can turn on and off. Used by
 * the account setting; deliberately ignores the stored preference so a hidden
 * plugin still has a row to switch back on.
 */
export async function listPlatformPluginSources(
  userId: string,
): Promise<PlatformPluginSource[]> {
  if (!userId) return [];

  const supabase = await createClient();
  const eligible = await loadEligiblePlatformPlugins({
    supabase,
    userId,
    surfaces: PLATFORM_SURFACES,
  });

  const sources = new Map<
    string,
    PlatformPluginSource & { orgs: Set<string> }
  >();
  for (const { plugin, membership } of eligible) {
    const key = plugin.manifest.key;
    const existing = sources.get(key);
    if (existing) {
      existing.orgs.add(membership.organizationName);
      continue;
    }
    sources.set(key, {
      pluginKey: key,
      name: plugin.manifest.name,
      description: plugin.manifest.description?.trim() || null,
      organizationNames: [],
      orgs: new Set([membership.organizationName]),
    });
  }

  return [...sources.values()]
    .map(({ orgs, ...source }) => ({
      ...source,
      organizationNames: [...orgs].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Resolver timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      // Keep a hung resolver from pinning the process alive.
      timer.unref?.();
    }),
  ]);
}

function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function sanitizeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // App-relative only; "//host" is protocol-relative and escapes the app.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

function sanitizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !Number.isFinite(Date.parse(trimmed))) return null;
  return trimmed;
}

/**
 * Rebuilds the DTO with exactly the contract keys so plugin-provided extras
 * (including accidental PII) never reach the platform renderer.
 */
function sanitizeFeedItem(
  value: unknown,
  sourceHref: string | null,
): PlatformFeedItem | null {
  if (!isRecord(value)) return null;

  const id = sanitizeText(value.id, 128);
  const kind = typeof value.kind === "string" ? value.kind : null;
  const title = sanitizeText(value.title, FEED_TITLE_MAX);
  const href = sanitizeHref(value.href);
  const publishedAt = sanitizeIsoTimestamp(value.publishedAt);
  const badgeLabel = sanitizeText(value.badgeLabel, FEED_BADGE_MAX);
  if (!id || !kind || !FEED_ITEM_KINDS.has(kind)) return null;
  if (!title || !href || !publishedAt || !badgeLabel) return null;

  return {
    id,
    kind: kind as PlatformFeedItem["kind"],
    title,
    summary: sanitizeText(value.summary, FEED_SUMMARY_MAX),
    href,
    publishedAt,
    pinned: value.pinned === true,
    badgeLabel,
    sourceHref,
  };
}

/**
 * The host feed's "View all" target. Built from the viewer's membership row so
 * a plugin can never point the platform's organization link somewhere else.
 */
function organizationHref(context: PlatformSurfaceContext): string | null {
  const slug = context.organizationSlug?.trim();
  return slug ? sanitizeHref(`/organization/${slug}`) : null;
}

function sanitizeCardStat(value: unknown): PlatformDashboardCardStat | null {
  if (!isRecord(value)) return null;
  const label = sanitizeText(value.label, CARD_TEXT_MAX);
  const statValue = sanitizeText(value.value, CARD_TEXT_MAX);
  if (!label || !statValue) return null;
  const hint = sanitizeText(value.hint, CARD_TEXT_MAX);
  return { label, value: statValue, ...(hint ? { hint } : {}) };
}

function sanitizeCardStatus(value: unknown): PlatformDashboardCard["status"] {
  if (!isRecord(value)) return null;
  const label = sanitizeText(value.label, CARD_TEXT_MAX);
  const tone = typeof value.tone === "string" ? value.tone : null;
  if (!label || !tone || !CARD_STATUS_TONES.has(tone)) return null;
  return { label, tone: tone as "positive" | "warning" | "neutral" };
}

function sanitizeDashboardCard(value: unknown): PlatformDashboardCard | null {
  if (!isRecord(value)) return null;
  const title = sanitizeText(value.title, FEED_TITLE_MAX);
  const href = sanitizeHref(value.href);
  if (!title || !href) return null;

  const stats = (Array.isArray(value.stats) ? value.stats : [])
    .map(sanitizeCardStat)
    .filter((stat): stat is PlatformDashboardCardStat => stat !== null)
    .slice(0, MAX_CARD_STATS);

  return { title, href, stats, status: sanitizeCardStatus(value.status) };
}

function compareFeedItems(left: PlatformFeedItem, right: PlatformFeedItem) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
}

function warnResolverFailure(
  surface: PlatformPluginSurface,
  contribution: PlatformPluginContribution,
  reason: unknown,
) {
  console.warn(
    `[platform-surfaces] ${contribution.plugin.manifest.key} failed to resolve ${surface} for organization ${contribution.context.organizationId}:`,
    reason,
  );
}

export async function resolvePlatformFeedItems(
  userId: string,
  options: ResolvePlatformFeedItemsOptions = {},
): Promise<PlatformFeedItem[]> {
  if (!userId) return [];

  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? DEFAULT_FEED_LIMIT), 1),
    MAX_FEED_LIMIT,
  );
  const timeoutMs = options.timeoutMs ?? PLUGIN_RESOLVE_TIMEOUT_MS;
  const contributions = (
    await loadPlatformSurfaceContributions({
      userId,
      surface: "platform.home.feed",
      limit,
    })
  ).filter((contribution) => contribution.plugin.resolvePlatformFeedItems);

  const settled = await Promise.allSettled(
    contributions.map((contribution) =>
      withTimeout(
        Promise.resolve().then(() =>
          contribution.plugin.resolvePlatformFeedItems!(contribution.context),
        ),
        timeoutMs,
      ),
    ),
  );

  const items: PlatformFeedItem[] = [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      warnResolverFailure(
        "platform.home.feed",
        contributions[index],
        result.reason,
      );
      return;
    }
    const sourceHref = organizationHref(contributions[index].context);
    const sanitized = (Array.isArray(result.value) ? result.value : [])
      .map((item) => sanitizeFeedItem(item, sourceHref))
      .filter((item): item is PlatformFeedItem => item !== null)
      .slice(0, limit);
    items.push(...sanitized);
  });

  return items.sort(compareFeedItems).slice(0, MAX_TOTAL_FEED_ITEMS);
}

export async function resolvePlatformDashboardCards(
  userId: string,
  options: ResolvePlatformDashboardCardsOptions = {},
): Promise<PlatformDashboardCard[]> {
  if (!userId) return [];

  const timeoutMs = options.timeoutMs ?? PLUGIN_RESOLVE_TIMEOUT_MS;
  const contributions = (
    await loadPlatformSurfaceContributions({
      userId,
      surface: "platform.dashboard.card",
      limit: 1,
    })
  ).filter((contribution) => contribution.plugin.resolvePlatformDashboardCard);

  const settled = await Promise.allSettled(
    contributions.map((contribution) =>
      withTimeout(
        Promise.resolve().then(() =>
          contribution.plugin.resolvePlatformDashboardCard!(
            contribution.context,
          ),
        ),
        timeoutMs,
      ),
    ),
  );

  const cards: PlatformDashboardCard[] = [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      warnResolverFailure(
        "platform.dashboard.card",
        contributions[index],
        result.reason,
      );
      return;
    }
    const card = sanitizeDashboardCard(result.value);
    if (card) cards.push(card);
  });

  return cards;
}
