import type { Metadata } from "next";

import { HERO_HEADLINE_TEXT } from "./homepage-copy";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lets-assist.com";

const title = `Let's Assist: ${HERO_HEADLINE_TEXT}`;

export const homepageMetadata: Metadata = {
  title: {
    absolute: title,
  },
  description:
    "Manage volunteer signups, QR or reviewed paper attendance, verified hours, and service certificates in one organization workspace.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title,
    description:
      "Manage volunteer signups, QR or reviewed paper attendance, verified hours, and service certificates in one organization workspace.",
    url: siteUrl,
    siteName: "Let's Assist",
    type: "website",
    images: [
      {
        url: `${siteUrl}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "Let's Assist volunteer project tools",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description:
      "Manage volunteer signups, QR or reviewed paper attendance, verified hours, and service certificates in one organization workspace.",
    images: [`${siteUrl}/opengraph-image`],
  },
  alternates: {
    canonical: siteUrl,
  },
};
