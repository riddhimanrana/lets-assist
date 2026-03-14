"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ActiveSystemBannersResponse, SystemBanner } from "@/types/system-banner";

const DISMISSED_BANNER_STORAGE_KEY = "lets-assist:dismissed-system-banner-tokens-v2";
const MAX_DISMISSED_TOKEN_COUNT = 50;

type DismissedBannerTokenMap = Record<string, number>;

const ICON_BY_TYPE: Record<SystemBanner["banner_type"], React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  outage: AlertCircle,
};

const TONE_VAR_BY_TYPE: Record<SystemBanner["banner_type"], string> = {
  info: "--info",
  success: "--success",
  warning: "--warning",
  outage: "--destructive",
};

const ALIGNMENT_CLASS_BY_TEXT_ALIGN: Record<
  NonNullable<SystemBanner["text_align"]>,
  string
> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const JUSTIFY_CLASS_BY_TEXT_ALIGN: Record<
  NonNullable<SystemBanner["text_align"]>,
  string
> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

function selectBannerForPath(
  response: ActiveSystemBannersResponse,
  pathname: string | null,
) {
  const isLandingPage = pathname === "/";

  if (isLandingPage && response.landing) {
    return response.landing;
  }

  return response.sitewide;
}

function buildBannerDismissToken(banner: SystemBanner): string {
  return `${banner.id}:${banner.updated_at ?? ""}`;
}

function readDismissedTokenMap(): DismissedBannerTokenMap {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(DISMISSED_BANNER_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const record = parsed as Record<string, unknown>;
    const normalized: DismissedBannerTokenMap = {};

    for (const [key, value] of Object.entries(record)) {
      if (typeof key === "string" && typeof value === "number") {
        normalized[key] = value;
      }
    }

    return normalized;
  } catch {
    return {};
  }
}

function writeDismissedTokenMap(map: DismissedBannerTokenMap) {
  if (typeof window === "undefined") return;

  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_DISMISSED_TOKEN_COUNT);

  localStorage.setItem(DISMISSED_BANNER_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export default function SystemStickyBanner() {
  const pathname = usePathname();
  const [response, setResponse] = useState<ActiveSystemBannersResponse | null>(null);
  const [dismissedBannerTokens, setDismissedBannerTokens] = useState<DismissedBannerTokenMap>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissedBannerTokens(readDismissedTokenMap());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchBanner = async () => {
      try {
        const res = await fetch("/api/system-banner/active", {
          cache: "no-store",
        });

        if (!res.ok) return;

        const json = (await res.json()) as ActiveSystemBannersResponse;
        if (!cancelled) {
          setResponse(json);
        }
      } catch {
        // Do not render noisy errors for a non-critical banner fetch.
      }
    };

    fetchBanner();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const activeBanner = useMemo(() => {
    if (!response) return null;
    return selectBannerForPath(response, pathname);
  }, [pathname, response]);

  if (!activeBanner) {
    return null;
  }

  const dismissToken = buildBannerDismissToken(activeBanner);

  if (activeBanner.dismissible && dismissedBannerTokens[dismissToken]) {
    return null;
  }

  const BannerIcon = ICON_BY_TYPE[activeBanner.banner_type] ?? ICON_BY_TYPE.info;
  const toneVar = TONE_VAR_BY_TYPE[activeBanner.banner_type] ?? "--info";
  const textAlign = activeBanner.text_align ?? "center";
  const showIcon = activeBanner.show_icon ?? true;

  const wrapperStyle: CSSProperties = {
    backgroundColor: `color-mix(in srgb, var(${toneVar}) 10%, var(--background))`,
    borderColor: `color-mix(in srgb, var(${toneVar}) 30%, var(--border))`,
    color: "var(--foreground)",
  };

  const iconStyle: CSSProperties = {
    color: `var(${toneVar})`,
  };

  const ctaStyle: CSSProperties = {
    borderColor: `color-mix(in srgb, var(${toneVar}) 35%, var(--border))`,
  };

  const handleDismiss = () => {
    const nextTokens: DismissedBannerTokenMap = {
      ...dismissedBannerTokens,
      [dismissToken]: Date.now(),
    };

    setDismissedBannerTokens(nextTokens);
    writeDismissedTokenMap(nextTokens);
  };

  const titlePresent = Boolean(activeBanner.title?.trim());

  return (
    <div className="z-30 w-full border-b" style={wrapperStyle} role="status" aria-live="polite">
      <div className="mx-auto w-full max-w-7xl px-4 py-3 md:px-6 md:py-3.5">
        <div className={cn("relative flex items-center gap-3", JUSTIFY_CLASS_BY_TEXT_ALIGN[textAlign])}>
          {showIcon ? (
            <span className="inline-flex shrink-0 items-center justify-center" style={iconStyle}>
              <BannerIcon className="h-4 w-4" />
            </span>
          ) : null}

          <div
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0",
              JUSTIFY_CLASS_BY_TEXT_ALIGN[textAlign],
              activeBanner.dismissible && "pr-8 md:pr-10",
            )}
          >
            <div className={cn("min-w-0", ALIGNMENT_CLASS_BY_TEXT_ALIGN[textAlign])}>
              {activeBanner.title ? (
                <p className="text-sm font-semibold leading-tight tracking-tight">{activeBanner.title}</p>
              ) : null}
              <p className={cn("text-sm text-foreground/95", titlePresent ? "mt-0.5 leading-relaxed" : "leading-relaxed")}>
                {activeBanner.message}
              </p>
            </div>

            {activeBanner.cta_label && activeBanner.cta_url ? (
              <div className="flex shrink-0 items-center">
                <Link
                  href={activeBanner.cta_url}
                  className="rounded-md border bg-background/40 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={ctaStyle}
                >
                  {activeBanner.cta_label}
                </Link>
              </div>
            ) : null}
          </div>

          {activeBanner.dismissible ? (
            <button
              type="button"
              onClick={handleDismiss}
              className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss banner"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
