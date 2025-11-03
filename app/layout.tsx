// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Navbar from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import localFont from "next/font/local";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PostHogProvider } from "./providers";
import { ToasterTheme } from "@/components/ToasterTheme";
import { NotificationListener } from "@/components/NotificationListener";
import GlobalNotificationProvider from "@/components/GlobalNotificationProvider";
import CalendarOAuthCallbackHandler from "@/components/CalendarOAuthCallbackHandler";
import { GeistMono } from 'geist/font/mono';
 
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
  const cookieStore = await cookies();

  // Create Supabase server client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookies) {
          try {
            cookies.forEach(({ name, value, options }) => {
              cookieStore.set({ name, value, ...options });
            });
          } catch (error) {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    },
  );

  // Fetch user on the server
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
              <div className="bg-background text-foreground min-h-screen flex flex-col">
                {/* Navbar now uses centralized useAuth hook */}
                <Navbar />
                <main className="flex-1">{children}</main>
                <ToasterTheme />
                <Footer />
                <SpeedInsights />
                <CalendarOAuthCallbackHandler />
                {/* Remove this duplicate listener - it's already in GlobalNotificationProvider */}
                {/* {user && <NotificationListener userId={user.id} />} */}
              </div>
            </PostHogProvider>
          </ThemeProvider>
        </GlobalNotificationProvider>
      </body>
    </html>
  );
}
