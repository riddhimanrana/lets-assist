import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";

import { checkSuperAdmin } from "../actions";
import { AdminLoadError, AdminPage } from "../components/AdminPage";
import { getSystemBannersForAdmin } from "./actions";
import { SystemBannerAdminClient } from "./SystemBannerAdminClient";

export const metadata = {
  title: "Admin system banner",
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
      <AdminPage>
        <PageHeader title="System sticky banners" />
        <AdminLoadError title="Error loading system banners" message={error} />
      </AdminPage>
    );
  }

  const sitewideBanner =
    data.find((banner) => banner.target_scope === "sitewide") ?? null;
  const landingBanner =
    data.find((banner) => banner.target_scope === "landing") ?? null;

  return (
    <AdminPage width="form">
      <PageHeader
        title="System sticky banners"
        description="Configure outage notices, maintenance updates, and announcement banners."
      />

      <SystemBannerAdminClient
        sitewideBanner={sitewideBanner}
        landingBanner={landingBanner}
      />
    </AdminPage>
  );
}
