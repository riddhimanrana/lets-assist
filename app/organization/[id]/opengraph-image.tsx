import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

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
  style?: "normal" | "italic";
};

const palette = {
  background: "hsl(0, 0%, 100%)",
  text: "hsl(240, 10%, 3.9%)",
  mutedText: "hsl(240, 3.8%, 46.1%)",
  border: "hsl(240, 5.9%, 90%)",
  surface: "hsl(240, 4.8%, 95.9%)",
  accent: "hsl(142.1, 76.2%, 36.3%)",
  accentText: "hsl(355.7, 100%, 97.3%)",
};

function cleanText(text: string) {
  // Remove all angle brackets to avoid leaving behind partial tags like "<script"
  return text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
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

async function getLogoDataUri(): Promise<string | null> {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo.png");
    const logoBuffer = await readFile(logoPath);
    const base64 = logoBuffer.toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.warn("OG logo read failed:", error);
    return null;
  }
}

function formatOrgType(type?: string | null) {
  if (type === "school") return "School";
  if (type === "company") return "Company";
  return "Nonprofit";
}

// Fetch organization data directly using Supabase API
async function getOrganizationData(orgId: string) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    // Check if it's a UUID (ID) or username
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        orgId,
      );
    const filterParam = isUUID ? `id=eq.${orgId}` : `username=eq.${orgId}`;

    const response = await fetch(
      `${supabaseUrl}/rest/v1/organizations?${filterParam}&select=id,name,description,logo_url,type`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data?.[0] || null;
  } catch (error) {
    console.error("Error fetching organization for OG image:", error);
    return null;
  }
}

export default async function Image({
  params,
  searchParams: _searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: { theme?: string };
}) {
  const { id } = await params;
  const org = await getOrganizationData(id);

  const name = org?.name ?? "Organization";
  const description =
    org?.description ?? "View volunteer opportunities and make a difference";
  const orgTypeLabel = formatOrgType(org?.type);
  const logoUrl = org?.logo_url;
  const [interRegular, interBold, logoSrc] = await Promise.all([
    loadFont("Inter-Regular.ttf"),
    loadFont("Inter-Bold.ttf"),
    getLogoDataUri(),
  ]);
  const resolvedLogoSrc = logoUrl ?? logoSrc;
  const fonts: OgFont[] = [];
  if (interRegular) {
    fonts.push({ name: "Inter", data: interRegular, weight: 400, style: "normal" });
  }
  if (interBold) {
    fonts.push({ name: "Inter", data: interBold, weight: 700, style: "normal" });
  }
  
  const trimmedName = name.length > 46 ? `${name.substring(0, 43)}…` : name;
  const cleanedDescription = cleanText(description ?? "");
  const trimmedDescription =
    cleanedDescription.length > 140
      ? `${cleanedDescription.substring(0, 137)}…`
      : cleanedDescription;

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
            {logoSrc ? (
              <img
                src={logoSrc}
                alt="Let's Assist"
                width={42}
                height={42}
                style={{ width: "42px", height: "42px", objectFit: "contain" }}
              />
            ) : null}
            <div style={{ fontSize: "30px", fontWeight: 700, display: "flex" }}>
              Let's Assist
            </div>
          </div>

          <div style={{ fontSize: "52px", fontWeight: 700, lineHeight: 1.1, display: "flex" }}>
            {trimmedName}
          </div>

          <div style={{ fontSize: "20px", color: palette.mutedText, display: "flex" }}>
            {orgTypeLabel} organization
          </div>

          <div
            style={{
              fontSize: "22px",
              color: palette.mutedText,
              lineHeight: 1.4,
              maxWidth: "680px",
              display: "flex",
            }}
          >
            {trimmedDescription}
          </div>
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
          {resolvedLogoSrc ? (
            <img
              src={resolvedLogoSrc}
              alt="Organization logo"
              width={180}
              height={180}
              style={{ width: "180px", height: "180px", objectFit: "contain" }}
            />
          ) : (
            <div
              style={{
                width: "160px",
                height: "160px",
                borderRadius: "28px",
                backgroundColor: palette.accent,
                color: palette.accentText,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "48px",
                fontWeight: 700,
              }}
            >
              LA
            </div>
          )}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}