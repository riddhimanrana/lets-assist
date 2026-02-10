import { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

import { Hero } from "./_components/Hero";
import { LandingLazySections } from "./LandingLazySections";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lets-assist.com";

export const metadata: Metadata = {
  title: "Let's Assist: Connect Volunteers with Opportunities",
  description:
    "A platform connecting volunteers with opportunities to make a difference in their communities. Find local volunteer projects, track your hours, and earn recognition for your service.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Let's Assist: Connect Volunteers with Opportunities",
    description:
      "A platform connecting volunteers with opportunities to make a difference in their communities. Find local volunteer projects, track your hours, and earn recognition for your service.",
    url: siteUrl,
    siteName: "Let's Assist",
    type: "website",
    images: [
      {
        url: `${siteUrl}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "Let's Assist - Connect volunteers with opportunities",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Let's Assist: Connect Volunteers with Opportunities",
    description:
      "A platform connecting volunteers with opportunities to make a difference in their communities. Find local volunteer projects, track your hours, and earn recognition for your service.",
    images: [`${siteUrl}/opengraph-image`],
  },
  alternates: {
    canonical: siteUrl,
  },
};

type SearchParams = Record<string, string | string[] | undefined>;

const getParam = (searchParams: SearchParams | undefined, key: string) => {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
};

export default async function HomePage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const searchParams = await props.searchParams;
  const error = getParam(searchParams, "error");
  const errorCode = getParam(searchParams, "error_code");
  const errorDescription = getParam(searchParams, "error_description");
  const noRedirect = getParam(searchParams, "noRedirect") === "1";
  const hasError = Boolean(error && errorDescription);

  const { user } = await getAuthUser();

  if (user && !noRedirect && !hasError) {
    redirect("/home");
  }

  if (error && errorDescription) {
    const decodedDescription = decodeURIComponent(errorDescription);
    let message = decodedDescription;

    if (errorCode === "otp_expired") {
      message =
        "Email link is invalid or has expired. Please request a new confirmation email.";
    } else if (errorCode === "invalid_grant") {
      message =
        "This link is no longer valid. Please request a new confirmation email.";
    }

    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-95 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-6 w-6" />
              Email Verification Error
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground">
            <p className="text-sm font-mono text-destructive mb-2">{message}</p>
            <p>Please try again or contact support if the issue persists.</p>
          </CardContent>
          <CardFooter className="flex justify-center gap-2">
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Back to Login
            </Link>
            <Link href="/" className={cn(buttonVariants())}>
              Go to Home
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <main className="flex flex-col min-h-screen overflow-x-hidden">
      <Hero />
      <LandingLazySections />
    </main>
  );
}
