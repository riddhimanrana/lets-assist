// app/layout.tsx
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Navbar from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import localFont from "next/font/local";

import { Toaster } from "@/components/ui/sonner";
import { QueryMessageToast } from "@/components/shared/QueryMessageToast";
import CalendarOAuthCallbackHandler from "@/components/calendar/CalendarOAuthCallbackHandler";
import { Suspense } from "react";
import SystemStickyBanner from "@/components/layout/SystemStickyBanner";
import { AppProviders } from "@/components/providers/AppProviders";

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

const overusedgrotesk = localFont({
  src: "../public/fonts/OverusedGrotesk-VF.woff2",
  display: "swap",
  variable: "--font-overusedgrotesk",
  weight: "300 900",
  style: "normal",
});

const nohemi = localFont({
  src: "../public/fonts/Nohemi Font Family/Nohemi-VF-BF6438cc58ad63d.ttf",
  display: "swap",
  variable: "--font-nohemi",
  weight: "100 900",
  style: "normal",
});

const cheeseMilky = localFont({
  src: "../Cheese Milky.otf",
  display: "swap",
  variable: "--font-cheese-milky",
  weight: "400",
  style: "normal",
});

const enableSpeedInsights = process.env.VERCEL === "1";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.className} ${GeistSans.variable} ${GeistMono.variable} ${overusedgrotesk.variable} ${nohemi.variable} ${cheeseMilky.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <AppProviders>
          <div className="bg-background text-foreground min-h-screen flex flex-col w-full">
            <SystemStickyBanner />
            <Navbar />
            <Toaster richColors />
            <main className="flex-1 w-full">{children}</main>
            <Suspense fallback={null}>
              <QueryMessageToast />
            </Suspense>
            <Footer />
            {enableSpeedInsights ? <SpeedInsights /> : null}
            <Suspense fallback={null}>
              <CalendarOAuthCallbackHandler />
            </Suspense>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
