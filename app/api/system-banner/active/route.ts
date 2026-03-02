import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/supabase/admin";
import type { ActiveSystemBannersResponse, SystemBanner } from "@/types/system-banner";

const SELECT_COLUMNS =
  "id, title, message, banner_type, target_scope, is_active, starts_at, ends_at, cta_label, cta_url, dismissible, show_icon, text_align, created_at, updated_at";

const EMPTY_RESPONSE: ActiveSystemBannersResponse = {
  sitewide: null,
  landing: null,
};

const isBannerLive = (banner: Pick<SystemBanner, "starts_at" | "ends_at">) => {
  const now = Date.now();

  const startsAtOk = !banner.starts_at || new Date(banner.starts_at).getTime() <= now;
  const endsAtOk = !banner.ends_at || new Date(banner.ends_at).getTime() >= now;

  return startsAtOk && endsAtOk;
};

const pickLatestByScope = (
  banners: SystemBanner[],
  scope: SystemBanner["target_scope"],
) => {
  return (
    banners
      .filter((banner) => banner.target_scope === scope)
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )[0] ?? null
  );
};

export async function GET() {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("system_banners")
      .select(SELECT_COLUMNS)
      .eq("is_active", true)
      .in("target_scope", ["sitewide", "landing"]);

    if (error) {
      return NextResponse.json(EMPTY_RESPONSE, {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const liveBanners = ((data ?? []) as SystemBanner[]).filter(isBannerLive);

    const response: ActiveSystemBannersResponse = {
      sitewide: pickLatestByScope(liveBanners, "sitewide"),
      landing: pickLatestByScope(liveBanners, "landing"),
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(EMPTY_RESPONSE, {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
