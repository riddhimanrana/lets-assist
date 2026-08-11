import type { Metadata } from "next";
import { resolvePlatformDashboardCards } from "@/lib/plugins/resolve-platform-surfaces";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { loadVolunteerDashboardData } from "./_components/dashboard-data";
import { VolunteerDashboardView } from "./_components/VolunteerDashboardView";

export const metadata: Metadata = {
  title: "Volunteer Dashboard",
  description: "Track your volunteering progress and achievements",
};

export default async function VolunteerDashboard() {
  const { user } = await getAuthUser();
  const [data, pluginCards] = await Promise.all([
    loadVolunteerDashboardData(),
    user ? resolvePlatformDashboardCards(user.id) : Promise.resolve([]),
  ]);
  return <VolunteerDashboardView {...data} pluginCards={pluginCards} />;
}
