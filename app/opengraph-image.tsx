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
  background: "#ffffff",
  text: "#09090b",
  primary: "#22c55e",
  primaryDark: "#16a34a",
  overlayGreen: "rgba(34, 197, 94, 0.15)",
  overlayLine: "rgba(0, 0, 0, 0.05)",
  mutedText: "#71717a",
};

async function loadFont(fileName: string) {
  try {
    const fontPath = path.join(process.cwd(), "public/fonts", fileName);
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

export default async function Image() {
  const [groteskBlack, interBold, logoSrc] = await Promise.all([
    loadFont("OverusedGrotesk-Bold.ttf"),
    loadFont("Inter-Bold.ttf"),
    getLogoDataUri(),
  ]);

  const fonts: OgFont[] = [];
  
  if (groteskBlack) {
    fonts.push({
      name: "Overused Grotesk",
      data: groteskBlack,
      weight: 900,
      style: "normal",
    });
  }

  if (interBold) {
    fonts.push({
      name: "Inter",
      data: interBold,
      weight: 700,
      style: "normal",
    });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          backgroundImage: "linear-gradient(to bottom right, #ffffff, #f0fdf4, #e8f5e9)",
          fontFamily: 'Overused Grotesk, Inter, "sans-serif"',
          color: palette.text,
          position: "relative",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        {/* Decorative Background Elements */}
        {/* Large Green Glow */}
        <div
          style={{
            position: "absolute",
            top: "-20%",
            left: "-10%",
            width: "60%",
            height: "80%",
            backgroundImage: "radial-gradient(circle at center, rgba(34, 197, 94, 0.2), transparent 70%)",
            filter: "blur(60px)",
            zIndex: 0,
          }}
        />
        
        {/* Another Glow at Bottom Right */}
        <div
          style={{
            position: "absolute",
            bottom: "-20%",
            right: "-10%",
            width: "60%",
            height: "80%",
            backgroundImage: "radial-gradient(circle at center, rgba(22, 163, 74, 0.15), transparent 70%)",
            filter: "blur(60px)",
            zIndex: 0,
          }}
        />

        {/* Subtle Grid dots */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage: "radial-gradient(circle, #e2e8f0 1.5px, transparent 1.5px)",
            backgroundSize: "48px 48px",
            opacity: 0.4,
            zIndex: 0,
          }}
        />

        {/* Top Brand Section - Positioned Absolutely to keep headline centered */}
        <div
          style={{
            position: "absolute",
            top: 60,
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            zIndex: 2,
          }}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Logo"
              width={48}
              height={48}
              style={{ width: "48px", height: "48px" }}
            />
          ) : null}
          <div
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: palette.text,
              fontFamily: "Overused Grotesk, sans-serif",
            }}
          >
            Let's Assist
          </div>
        </div>

        {/* Main Content Stack - Dead Center */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
            width: "100%",
            padding: "0 40px",
          }}
        >
          {/* Huge Headline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              fontSize: 110,
              fontWeight: 900,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              maxWidth: 1100,
              paddingBottom: 20,
            }}
          >
            <div style={{ display: "flex" }}>Give back to your</div>
            <div style={{ display: "flex", gap: 24, padding: "10px 0" }}>
              community,{" "}
              <div
                style={{
                  backgroundImage: "linear-gradient(to right, #16a34a, #22c55e, #4ade80)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                  display: "flex",
                  paddingRight: 15,
                }}
              >
                your way.
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length ? fonts : undefined,
    },
  );
}