// app/layout.tsx
import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Navbar from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import localFont from "next/font/local";
import { PostHogProvider } from "./providers";

import { Toaster } from "@/components/ui/sonner";
import { QueryMessageToast } from "@/components/shared/QueryMessageToast";
import GlobalNotificationProvider from "@/components/providers/GlobalNotificationProvider";
import CalendarOAuthCallbackHandler from "@/components/calendar/CalendarOAuthCallbackHandler";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { Suspense } from "react";
import SystemStickyBanner from "@/components/layout/SystemStickyBanner";

export const metadata: Metadata = {
  title: {
    template: "%s - Let's Assist",
    default: "Let's Assist",
  },
  description:
    "Find volunteering opportunities and connect with organizations in need of your help.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://lets-assist.com",
  ),
  keywords: [
    "volunteering",
    "volunteer opportunities",
    "community service",
    "nonprofit",
    "volunteer hours",
    "PVSA",
    "volunteer tracking",
  ],
  authors: [{ name: "Let's Assist" }],
  creator: "Let's Assist",
  publisher: "Let's Assist",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://lets-assist.com",
    siteName: "Let's Assist",
    title: "Let's Assist",
    description:
      "Find volunteering opportunities and connect with organizations in need of your help.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Let's Assist",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Let's Assist",
    description:
      "Find volunteering opportunities and connect with organizations in need of your help.",
    images: ["/opengraph-image"],
  },
};

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const overusedgrotesk = localFont({
  src: "../public/fonts/OverusedGrotesk-VF.woff2",
  display: "swap",
  variable: "--font-overusedgrotesk",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head />
      <body
        className={`${geistMono.variable} ${overusedgrotesk.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <PostHogProvider>
              <GlobalNotificationProvider>
                <div className="bg-background text-foreground min-h-screen flex flex-col w-full">
                  <SystemStickyBanner />
                  <Navbar />
                  <Toaster richColors />
                  <main className="flex-1 w-full">{children}</main>
                  <Suspense fallback={null}>
                    <QueryMessageToast />
                  </Suspense>
                  <Footer />
                  <SpeedInsights />
                  <Suspense fallback={null}>
                    <CalendarOAuthCallbackHandler />
                  </Suspense>
                </div>
              </GlobalNotificationProvider>
            </PostHogProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
