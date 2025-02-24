// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from 'next-themes'
import { SpeedInsights } from "@vercel/speed-insights/next"
import Navbar from "@/components/Navbar"
import { Footer } from "@/components/Footer"
import localFont from "next/font/local";
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { PostHogProvider } from './providers'

const overusedgrotesk = localFont({
  src: '../public/fonts/OverusedGrotesk-VF.woff2',
  display: 'swap',
  variable: '--font-overusedgrotesk',
})

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "Let's Assist | Volunteering Platform",
  description: "Let's Assist is a platform that connects volunteers with people in need of assistance.",
};

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
    }
  );

  // Fetch user on the server
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${overusedgrotesk.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PostHogProvider>
          <div className="bg-background text-foreground min-h-screen flex flex-col">
            {/* Pass server-fetched user to Navbar */}
            <Navbar initialUser={user} />
            <main className="flex-1">
              {children}
            </main>
            <Footer />
            <SpeedInsights />
          </div>
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}