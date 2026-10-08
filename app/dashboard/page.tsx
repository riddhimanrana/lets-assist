import { PlatformRatingPrompt } from "@/components/feedback/PlatformRatingPrompt";
import { getPlatformRatingPromptState } from "@/lib/feedback/platform-prompt";
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
  const [data, pluginCards, showRatingPrompt] = await Promise.all([
    loadVolunteerDashboardData(),
    user ? resolvePlatformDashboardCards(user.id) : Promise.resolve([]),
    user
      ? getPlatformRatingPromptState(user.id, {
          contextKind: "volunteer_hours",
          contextId: user.id,
        })
      : Promise.resolve(false),
  ]);
  return (
    <VolunteerDashboardView
      {...data}
      pluginCards={pluginCards}
      ratingPrompt={
        user && showRatingPrompt ? (
          <PlatformRatingPrompt
            key={user.id}
            show
            userId={user.id}
            contextKind="volunteer_hours"
            contextId={user.id}
          />
        ) : null
      }
    />
  );
}
