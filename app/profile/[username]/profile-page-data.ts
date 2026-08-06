import "server-only";

import { differenceInMinutes, isBefore, parseISO } from "date-fns";
import type { Metadata } from "next";

import { getPublicProfileByUsername } from "@/lib/profile/public";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
  volunteer_hours?: number;
  verified_hours?: number;
  trusted_member?: boolean;
  profile_visibility?: string | null;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  location: string;
  event_type: string;
  status: "upcoming" | "in-progress" | "completed" | "cancelled";
  created_at: string;
  cover_image_url?: string;
}

export interface Organization {
  id: string;
  name: string;
  username: string;
  type: string;
  verified: boolean;
  logo_url: string | null;
  description: string | null;
}

export interface OrganizationMembership {
  role: "admin" | "staff" | "member";
  organizations: Organization[];
}

export interface OrganizationResponse {
  role: "admin" | "staff" | "member";
  organizations: Organization[];
}

export async function buildProfileMetadata(
  username: string,
): Promise<Metadata> {
  const { data: profile } = await getPublicProfileByUsername(username);
  const baseUrl = new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000"),
  );
  const profileUrl = new URL(`/profile/${username}`, baseUrl);
  const ogImageUrl = new URL(`/profile/${username}/opengraph-image`, baseUrl);
  const displayName = profile?.full_name || username;
  const description =
    profile?.profile_visibility === "public"
      ? `Profile page for ${displayName}`
      : "Profile on Let's Assist.";
  const title = `${displayName} (${username})` || username;

  return {
    title,
    description,
    metadataBase: baseUrl,
    alternates: { canonical: profileUrl },
    openGraph: {
      title,
      description,
      type: "profile",
      url: profileUrl,
      siteName: "Let's Assist",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${displayName} — Let's Assist`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export function calculateHours(startTimeStr: string, endTimeStr: string) {
  try {
    if (!startTimeStr || !endTimeStr) return 0;
    const start = parseISO(startTimeStr);
    const end = parseISO(endTimeStr);
    if (isBefore(end, start)) return 0;
    return Math.round((differenceInMinutes(end, start) / 60) * 10) / 10;
  } catch (error) {
    console.error("Error calculating hours:", error, {
      startTimeStr,
      endTimeStr,
    });
    return 0;
  }
}
