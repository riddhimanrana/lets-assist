import { ImageResponse } from "next/og";
import { getProject } from "./actions";

export const runtime = "nodejs";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image({ params }: { params: { id: string } }) {
  const { project } = await getProject(params.id);

  const title = project?.title ?? "Volunteer Project";
  const organizationName = project?.organization?.name ?? "Let’s Assist";
  const location = project?.location ?? "Community opportunity";
  const coverImageUrl = project?.cover_image_url ?? null;
  const organizationLogoUrl = project?.organization?.logo_url ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #0f172a 100%)",
          fontFamily: "Inter, ui-sans-serif, system-ui",
          color: "#f8fafc",
          position: "relative",
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "64px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "28px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {organizationLogoUrl ? (
              <img
                src={organizationLogoUrl}
                alt=""
                width={56}
                height={56}
                style={{
                  borderRadius: "14px",
                  objectFit: "cover",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              />
            ) : (
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "14px",
                  background: "rgba(255,255,255,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
              >
                LA
              </div>
            )}
            <div style={{ fontSize: "22px", opacity: 0.85, fontWeight: 600 }}>{organizationName}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                fontSize: "54px",
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: "26px", opacity: 0.85 }}>{location}</div>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "12px",
              padding: "10px 18px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.12)",
              fontSize: "18px",
              fontWeight: 600,
            }}
          >
            Let’s Assist · Volunteer Opportunity
          </div>
        </div>

        <div
          style={{
            width: "440px",
            padding: "48px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {coverImageUrl ? (
            <img
              src={coverImageUrl}
              alt=""
              width={360}
              height={480}
              style={{
                width: "360px",
                height: "480px",
                objectFit: "cover",
                borderRadius: "28px",
                border: "1px solid rgba(255,255,255,0.2)",
                boxShadow: "0 24px 60px rgba(15, 23, 42, 0.45)",
              }}
            />
          ) : (
            <div
              style={{
                width: "360px",
                height: "480px",
                borderRadius: "28px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "linear-gradient(160deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: "32px",
                fontSize: "26px",
                fontWeight: 600,
                color: "rgba(248,250,252,0.9)",
              }}
            >
              Discover volunteer opportunities that make a difference.
            </div>
          )}
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
