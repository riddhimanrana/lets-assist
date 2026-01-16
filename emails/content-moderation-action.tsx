import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Link,
  Preview,
} from "@react-email/components";
import * as React from "react";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";
import EmailButton from "./_components/EmailButton";

interface ContentModerationActionProps {
  userName: string;
  contentTitle: string;
  contentTypeLabel: string;
  actionLabel: string;
  reason?: string;
  contentUrl?: string;
  supportUrl?: string;
}

export default function ContentModerationActionEmail({
  userName = "there",
  contentTitle = "Untitled content",
  contentTypeLabel = "content",
  actionLabel = "updated",
  reason = "This content violated our community guidelines.",
  contentUrl = "https://lets-assist.com",
  supportUrl = "https://lets-assist.com/help",
}: ContentModerationActionProps) {
  const previewText =
    actionLabel === "issued a warning about"
      ? `Warning about your ${contentTypeLabel}`
      : `Your ${contentTypeLabel} was ${actionLabel}`;

  return (
    <Html lang="en">
      <Head>
        <style>{`
          @media only screen and (max-width: 640px) {
            .container {
              width: 100% !important;
              max-width: 100% !important;
              padding: 20px 0 !important;
              margin: 0 !important;
            }
            .content {
              padding: 12px 16px !important;
            }
            .card {
              border: none !important;
              border-radius: 0 !important;
            }
          }
        `}</style>
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container} className="container">
          <Section style={card} className="card">
            <EmailHeader />

            <Section style={content} className="content">
              <Heading style={heading}>Content moderation update</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>
                We reviewed your {contentTypeLabel} <strong>{contentTitle}</strong> and {actionLabel} it.
              </Text>

              <Section style={reasonBox}>
                <Text style={label}>Why this happened</Text>
                <Text style={reasonText}>{reason}</Text>
              </Section>

              <Section style={subtleBox}>
                <Text style={label}>What happens next</Text>
                <Text style={smallText}>
                  If you believe this was in error, reply to this email or contact support and we’ll take another look.
                </Text>
              </Section>

              <Section style={buttonContainer}>
                <EmailButton href={supportUrl}>Contact support</EmailButton>
              </Section>

              {contentUrl && (
                <Section style={linkBox}>
                  <Text style={smallText}>
                    You can review the content details here: <Link style={link} href={contentUrl}>{contentUrl}</Link>
                  </Text>
                </Section>
              )}
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
  color: "#111827",
  fontSize: "28px",
  fontWeight: "700" as const,
  margin: "10px 0 12px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#111827",
  fontSize: "16px",
  lineHeight: "1.65",
  textAlign: "left" as const,
  margin: "12px 0",
};

const reasonBox = {
  padding: "16px",
  margin: "14px 0 0",
  backgroundColor: "#fef2f2",
  border: "1px solid #fee2e2",
  borderRadius: "12px",
};

const label = {
  color: "#111827",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 6px 0",
};

const reasonText = {
  color: "#7f1d1d",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};

const subtleBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #eef2f7",
  padding: "16px",
  margin: "14px 0 0",
  borderRadius: "12px",
};

const smallText = {
  color: "#374151",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "6px 0",
};

const buttonContainer = {
  padding: "18px 0 10px",
  textAlign: "center" as const,
};

const linkBox = {
  marginTop: "8px",
};

const link = {
  color: "#16A34A",
  fontSize: "13px",
  fontWeight: "500" as const,
  textDecoration: "underline",
  wordBreak: "break-all" as const,
};
