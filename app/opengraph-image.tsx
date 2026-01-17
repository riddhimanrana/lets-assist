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

export default async function Image({
  searchParams: _searchParams,
}: {
  searchParams?: { theme?: string };
} = {}) {
  const baseUrl = getBaseUrl();
  const logoUrl = `${baseUrl}/logo.png`;
  const logoSrc = logoUrl;
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
            gap: "20px",
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
            <div style={{ fontSize: "32px", fontWeight: 700, display: "flex" }}>
              Let's Assist
            </div>
          </div>

          <div style={{ fontSize: "56px", fontWeight: 700, lineHeight: 1.1, display: "flex", flexDirection: "column" }}>
            <span>Volunteer together.</span>
            <span>Make impact.</span>
          </div>

          <div
            style={{
              fontSize: "24px",
              color: palette.mutedText,
              maxWidth: "680px",
              lineHeight: 1.4,
              display: "flex",
            }}
          >
            Discover volunteer opportunities, connect with trusted
            organizations, and track every hour of impact.
          </div>
        </div>

        <div
          style={{
            width: "360px",
            height: "360px",
            borderRadius: "28px",
            backgroundColor: palette.surface,
            border: `1px solid ${palette.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Let's Assist logo"
              width={180}
              height={180}
              style={{ width: "180px", height: "180px", objectFit: "contain" }}
            />
          ) : (
            <div
              style={{
                width: "180px",
                height: "180px",
                borderRadius: "32px",
                backgroundColor: palette.accent,
                color: palette.accentText,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "56px",
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