import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

import EmailFooter from "./_components/EmailFooter";
import EmailHeader from "./_components/EmailHeader";

interface DataExportReadyEmailProps {
  userName?: string;
  generatedAt: string;
  recordsExported: number;
  attachmentName: string;
  accountUrl: string;
  downloadUrl?: string;
  linkExpiresAt?: string;
  deliveryMode?: "attachment_and_link" | "link_only";
  zipSizeBytes?: number;
}

export default function DataExportReadyEmail({
  userName = "there",
  generatedAt,
  recordsExported,
  attachmentName,
  accountUrl,
  downloadUrl,
  linkExpiresAt,
  deliveryMode = "attachment_and_link",
  zipSizeBytes,
}: DataExportReadyEmailProps) {
  const generatedDate = new Date(generatedAt).toLocaleString();
  const expiresDate = linkExpiresAt ? new Date(linkExpiresAt).toLocaleString() : null;
  const zipSizeMb = typeof zipSizeBytes === "number" ? (zipSizeBytes / (1024 * 1024)).toFixed(2) : null;

  return (
    <Html lang="en">
      <Head />
      <Preview>Your Let's Assist data export is attached</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={heading}>Your data export is ready</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>
                {deliveryMode === "attachment_and_link"
                  ? "Your account data export has been generated and attached to this email."
                  : "Your account data export has been generated and is ready using the secure download link below."}
              </Text>

              <Section style={detailsBox}>
                <Text style={detailLine}>
                  <strong>Generated:</strong> {generatedDate}
                </Text>
                <Text style={detailLine}>
                  <strong>Records exported:</strong> {recordsExported}
                </Text>
                <Text style={detailLine}>
                  <strong>Attachment:</strong> {attachmentName}
                </Text>
                {zipSizeMb && (
                  <Text style={detailLine}>
                    <strong>ZIP size:</strong> {zipSizeMb} MB
                  </Text>
                )}
              </Section>

              {downloadUrl && (
                <Section style={downloadBox}>
                  <Text style={detailLine}>
                    <strong>Secure download link:</strong>
                  </Text>
                  <Text style={smallText}>
                    <Link href={downloadUrl} style={link}>
                      Download your ZIP export
                    </Link>
                  </Text>
                  {expiresDate && (
                    <Text style={smallText}>This link expires on {expiresDate}.</Text>
                  )}
                </Section>
              )}

              <Text style={smallText}>
                For security, sensitive token-like fields are redacted in the exported file.
              </Text>

              <Text style={smallText}>
                You can always generate a fresh copy from your account security page: {" "}
                <Link href={accountUrl} style={link}>
                  {accountUrl}
                </Link>
              </Text>
            </Section>

            <EmailFooter />
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#ffffff",
  fontFamily:
    "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
};

const container = {
  margin: "0 auto",
  padding: "40px 16px 64px",
  maxWidth: "640px",
};

const card = {
  backgroundColor: "#ffffff",
};

const content = {
  padding: "8px 24px 8px",
};

const heading = {
  color: "#000000",
  fontSize: "28px",
  fontWeight: "700" as const,
  margin: "10px 0 12px",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#000000",
  fontSize: "16px",
  lineHeight: "1.65",
  margin: "12px 0",
};

const detailsBox = {
  margin: "16px 0",
  backgroundColor: "#f8f9fa",
  padding: "16px",
  borderLeft: "4px solid #16A34A",
  borderRadius: "12px",
};

const downloadBox = {
  margin: "16px 0",
  backgroundColor: "#f0fdf4",
  padding: "14px",
  borderLeft: "4px solid #15803d",
  borderRadius: "12px",
};

const detailLine = {
  margin: "6px 0",
  color: "#111827",
  fontSize: "14px",
  lineHeight: "1.6",
};

const smallText = {
  color: "#374151",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "10px 0",
};

const link = {
  color: "#16A34A",
  textDecoration: "underline",
};