import type { Metadata } from "next";
import { loadVolunteerDashboardData } from "./_components/dashboard-data";
import { VolunteerDashboardView } from "./_components/VolunteerDashboardView";

export const metadata: Metadata = {
  title: "Volunteer Dashboard",
  description: "Track your volunteering progress and achievements",
};

export default async function VolunteerDashboard() {
  const data = await loadVolunteerDashboardData();
  return <VolunteerDashboardView {...data} />;
}
