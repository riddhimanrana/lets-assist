import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

type OgFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight?: OgFontWeight;
  style?: "normal" | "italic" | "oblique";
};

type ProfileRecord = {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string | null;
  profile_visibility?: string | null;
  trusted_member?: boolean | null;
};

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

const palette = {
  background: "hsl(0, 0%, 100%)",
  text: "hsl(240, 10%, 3.9%)",
  mutedText: "hsl(240, 3.8%, 46.1%)",
  border: "hsl(240, 5.9%, 90%)",
  surface: "hsl(240, 4.8%, 95.9%)",
  accent: "hsl(142.1, 76.2%, 36.3%)",
  accentText: "hsl(355.7, 100%, 97.3%)",
};

function normalizeUrl(url: string | null | undefined, baseUrl: string) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${baseUrl}${url}`;
  return `${baseUrl}/${url}`;
}

function formatMonthYear(dateInput?: string | null) {
  if (!dateInput) return null;
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "LA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function loadFont(fileName: string) {
  try {
    const fontPath = path.join(
      process.cwd(),
      "public",
      "fonts",
      fileName,
    );
    const fontBuffer = await readFile(fontPath);
    return fontBuffer.buffer.slice(
      fontBuffer.byteOffset,
      fontBuffer.byteOffset + fontBuffer.byteLength,
    );
  } catch (error) {
    console.warn("OG font read failed:", error);
    return null;
  }
}

async function getProfileData(username: string) {
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id,username,full_name,avatar_url,created_at,profile_visibility,trusted_member",
      )
      .eq("username", username)
      .maybeSingle<ProfileRecord>();

    if (error) {
      console.error("Error fetching profile for OG image:", error);
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("Error fetching profile for OG image:", error);
    return null;
  }
}

export default async function Image({
  params,
  searchParams: _searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams?: { theme?: string };
}) {
  const { username } = await params;
  const profile = await getProfileData(username);

  const visibility = (profile?.profile_visibility ?? "public")
    .toString()
    .trim()
    .toLowerCase();
  const isPublicProfile = Boolean(profile) && visibility === "public";
  const baseUrl = getBaseUrl();
  const displayName = isPublicProfile
    ? profile?.full_name || profile?.username || "Volunteer"
    : "Profile unavailable";
  const handle = isPublicProfile && profile?.username
    ? `@${profile.username}`
    : "lets-assist.com";
  const joinedLabel = isPublicProfile ? formatMonthYear(profile?.created_at) : null;
  const avatarUrl = isPublicProfile ? normalizeUrl(profile?.avatar_url, baseUrl) : null;
  const fallbackLogoUrl = `${baseUrl}/logo.png`;
  const avatarSrc = avatarUrl ?? undefined;
  const initials = getInitials(displayName);

  const [interRegular, interBold] = await Promise.all([
    loadFont("Inter-Regular.ttf"),
    loadFont("Inter-Bold.ttf"),
  ]);
  const fonts: OgFont[] = [];
  if (interRegular) {
    fonts.push({ name: "Inter", data: interRegular, weight: 400, style: "normal" });
  }
  if (interBold) {
    fonts.push({ name: "Inter", data: interBold, weight: 700, style: "normal" });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          gap: "48px",
          padding: "64px",
          backgroundColor: palette.background,
          fontFamily: "Inter, ui-sans-serif, system-ui",
          color: palette.text,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: "18px",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {fallbackLogoUrl ? (
              <img
                src={fallbackLogoUrl}
                alt="Let's Assist"
                style={{ width: "42px", height: "42px", objectFit: "contain" }}
              />
            ) : null}
            <div style={{ fontSize: "30px", fontWeight: 700, display: "flex" }}>
              Let&apos;s Assist
            </div>
          </div>

          <div
            style={{
              fontSize: "54px",
              fontWeight: 700,
              lineHeight: 1.1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {displayName}
          </div>

          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ fontSize: "22px", color: palette.mutedText, display: "flex" }}>
              {handle}
            </div>
          </div>

          <div
            style={{
              fontSize: "22px",
              color: palette.mutedText,
              lineHeight: 1.4,
              maxWidth: "640px",
              display: "flex",
            }}
          >
            {isPublicProfile
              ? "Volunteer profile on Let’s Assist."
              : "This profile is private or unavailable."}
          </div>

          {joinedLabel ? (
            <div
              style={{
                fontSize: "18px",
                color: palette.text,
                backgroundColor: palette.surface,
                border: `1px solid ${palette.border}`,
                borderRadius: "999px",
                padding: "8px 14px",
                alignSelf: "flex-start",
                display: "flex",
              }}
            >
              Joined {joinedLabel}
            </div>
          ) : null}
        </div>

        <div
          style={{
            width: "360px",
            height: "360px",
            borderRadius: "24px",
            backgroundColor: palette.surface,
            border: `1px solid ${palette.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {avatarSrc ? (
            <div
              style={{
                width: "220px",
                height: "220px",
                borderRadius: "999px",
                overflow: "hidden",
                border: `1px solid ${palette.border}`,
                backgroundColor: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={avatarSrc}
                alt={displayName}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          ) : (
            <div
              style={{
                width: "200px",
                height: "200px",
                borderRadius: "999px",
                backgroundColor: palette.accent,
                color: palette.accentText,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "64px",
                fontWeight: 700,
              }}
            >
              {initials}
            </div>
          )}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
