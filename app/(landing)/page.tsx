import { Metadata } from "next";
import HomeClient from "./HomeClient";

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

export default function HomePage() {
  return <HomeClient />;
}
