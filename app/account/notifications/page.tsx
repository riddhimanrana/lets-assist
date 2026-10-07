import { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthUser } from "@/lib/supabase/auth-helpers";

import { NotificationSettings } from "./NotificationSettings";

export const metadata: Metadata = {
  title: "Notification Settings",
  description: "Manage your notification preferences",
};

export default async function NotificationsPage() {
  const { user } = await getAuthUser();
  if (!user) redirect("/login?redirect=/account/notifications");

  return <NotificationSettings />;
}
