// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Navbar from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import localFont from "next/font/local";
import { PostHogProvider } from "./providers";
import { ToasterTheme } from "@/components/theme/ToasterTheme";
import GlobalNotificationProvider from "@/components/providers/GlobalNotificationProvider";
import CalendarOAuthCallbackHandler from "@/components/calendar/CalendarOAuthCallbackHandler";
import { GeistMono } from 'geist/font/mono';
import { AuthProvider } from "@/components/providers/AuthProvider";
import { createClient } from "@/utils/supabase/server";
 
export const metadata: Metadata = {
  title: {
    template: "%s - Let's Assist",
    default: "Let's Assist",
  },
  description: 'Find volunteering opportunities and connect with organizations in need of your help.',
  metadataBase: new URL('https://lets-assist.com'),
};

const overusedgrotesk = localFont({
  src: "../public/fonts/OverusedGrotesk-VF.woff2",
  display: "swap",
  variable: "--font-overusedgrotesk",
});


const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});



export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${GeistMono.variable} ${overusedgrotesk.className}`}>
        <GlobalNotificationProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <PostHogProvider>
              <AuthProvider initialUser={user}>
                <div className="bg-background text-foreground min-h-screen flex flex-col">
                  {/* Navbar now uses centralized useAuth hook */}
                  <Navbar />
                  <main className="flex-1">{children}</main>
                  <ToasterTheme />
                  <Footer />
                  <SpeedInsights />
                  <CalendarOAuthCallbackHandler />
                </div>
              </AuthProvider>
            </PostHogProvider>
          </ThemeProvider>
        </GlobalNotificationProvider>
      </body>
    </html>
  );
}
