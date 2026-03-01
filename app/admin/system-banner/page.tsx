import { redirect } from "next/navigation";

import { checkSuperAdmin } from "../actions";
import { getSystemBannersForAdmin } from "./actions";
import { SystemBannerAdminClient } from "./SystemBannerAdminClient";

export const metadata = {
  title: "System Banner | Admin Dashboard",
  description:
    "Create and manage sticky system banners for sitewide and landing page notifications.",
};

export default async function AdminSystemBannerPage() {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await getSystemBannersForAdmin();

  if (error) {
    return (
      <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8 md:px-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          <p className="font-medium">Error loading system banners</p>
          <p className="mt-2 text-sm opacity-90">{error}</p>
        </div>
      </div>
    );
  }

  const sitewideBanner = data.find((banner) => banner.target_scope === "sitewide") ?? null;
  const landingBanner = data.find((banner) => banner.target_scope === "landing") ?? null;

  return (
    <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8 md:px-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">System Sticky Banners</h1>
        <p className="text-muted-foreground">
          Configure outage notices, maintenance updates, and announcement banners.
        </p>
      </div>

      <SystemBannerAdminClient
        sitewideBanner={sitewideBanner}
        landingBanner={landingBanner}
      />
    </div>
  );
}
