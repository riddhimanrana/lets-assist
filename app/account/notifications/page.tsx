import { Metadata } from "next";
import { NotificationSettings } from "./NotificationSettings";

export const metadata: Metadata = {
  title: "Notification Settings",
  description: "Manage your notification preferences",
};

export default function NotificationsPage() {
  return <NotificationSettings />;
}
