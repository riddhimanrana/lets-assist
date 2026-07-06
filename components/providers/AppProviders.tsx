"use client";

import { AuthProvider } from "@/components/providers/AuthProvider";
import GlobalNotificationProvider from "@/components/providers/GlobalNotificationProvider";
import { ThemeProvider } from "@/components/theme/theme-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <GlobalNotificationProvider>{children}</GlobalNotificationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
