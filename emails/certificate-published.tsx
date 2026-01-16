import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";

interface CertificatePublishedProps {
  volunteerName: string;
  projectTitle: string;
  certificateId: string;
  certificateUrl: string;
  isAutoPublished: boolean;
  eventStart?: string;
  eventEnd?: string;
  timezone?: string;
}

export default function CertificatePublished({
  volunteerName = "John Doe",
  projectTitle = "Beach Cleanup Drive",
  certificateId = "CERT-2026-001",
  certificateUrl = "https://lets-assist.com/certificates/cert-123",
  isAutoPublished = false,
  eventStart,
  eventEnd,
  timezone,
}: CertificatePublishedProps) {
  const timeZone = (() => {
    if (!timezone) return "America/Los_Angeles";
    try {
      // Validate IANA timezone.
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      return "America/Los_Angeles";
    }
  })();

  const eventDateStr = (() => {
    if (!eventStart || !eventEnd) return undefined;
    try {
      const start = new Date(eventStart);
      return start.toLocaleDateString("en-US", {
        timeZone,
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return undefined;
    }
  })();

  const eventTimeStr = (() => {
    if (!eventStart || !eventEnd) return undefined;
    try {
      const start = new Date(eventStart);
      const end = new Date(eventEnd);

      const startTime = start.toLocaleTimeString("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
        hour12: true,
      });

      const endTime = end.toLocaleTimeString("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
        hour12: true,
      });

      return `${startTime} - ${endTime}`;
    } catch {
      return undefined;
    }
  })();

  const eventDateDisplay = eventDateStr ?? "TBD";
  const eventTimeDisplay = eventTimeStr ?? "TBD";

  return (
    <Html lang="en">
      <Head>
        <style>{`
          @media only screen and (max-width: 640px) {
            .container {
              width: 100% !important;
              max-width: 100% !important;
              padding: 0 !important;
              margin: 0 !important;
            }
            .card {
              border: none !important;
              border-radius: 0 !important;
            }
          }
        `}</style>
      </Head>
      <Body style={main}>
        <Container className="container" style={container}>
          <Section className="card" style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={heading1}>Your Certificate is Ready!</Heading>

              <Text style={paragraph}>Hi {volunteerName},</Text>

              <Text style={paragraph}>
                Great news! Your volunteer certificate for <strong>{projectTitle}</strong>{" "}
                {isAutoPublished
                  ? "has been automatically published and is now available to view."
                  : "has been published and is now available to view."}
              </Text>

              {isAutoPublished && (
                <Section style={autoPublishBox}>
                  <Row>
                    <Column style={autoPublishContent}>
                      <Heading style={autoPublishTitle}>📅 Automatic Publishing</Heading>
                      <Text style={autoPublishText}>
                        This certificate was automatically generated 48 hours after the event ended, as no manual adjustments were needed.
                      </Text>
                    </Column>
                  </Row>
                </Section>
              )}

              <Section style={eventDetailsBox}>
                <Row>
                  <Column style={eventDetailsContent}>
                    <Row style={eventDetailRow}>
                      <Column style={detailLabel}>
                        <Text style={detailLabelText}>Project</Text>
                      </Column>
                      <Column style={detailValue}>
                        <Text style={detailValueText}>{projectTitle}</Text>
                      </Column>
                    </Row>

                    <Row style={eventDetailRow}>
                      <Column style={detailLabel}>
                        <Text style={detailLabelText}>Date</Text>
                      </Column>
                      <Column style={detailValue}>
                        <Text style={detailValueText}>{eventDateDisplay}</Text>
                      </Column>
                    </Row>

                    <Row style={eventDetailRow}>
                      <Column style={detailLabel}>
                        <Text style={detailLabelText}>Time</Text>
                      </Column>
                      <Column style={detailValue}>
                        <Text style={detailValueText}>{eventTimeDisplay}</Text>
                      </Column>
                    </Row>

                    <Row style={eventDetailRowLast}>
                      <Column style={detailLabel}>
                        <Text style={detailLabelText}>Certificate ID</Text>
                      </Column>
                      <Column style={detailValue}>
                        <Text style={detailValueCode}>{certificateId}</Text>
                      </Column>
                    </Row>
                  </Column>
                </Row>
              </Section>

              <Section style={buttonContainer}>
                <EmailButton href={certificateUrl}>View My Certificate</EmailButton>
              </Section>

              <Section style={gettingStarted}>
                <Text style={label}>Having trouble with the button?</Text>
                <Text style={smallText}>
                  You can also use this direct link:{" "}
                  <Link style={link} href={certificateUrl}>
                    {certificateUrl}
                  </Link>
                </Text>
              </Section>

              <Text style={helpText}>
                You can view, download, and share your certificate using the link above. This certificate serves as official recognition of your volunteer contribution.
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

const heading1 = {
  color: "#000000",
  fontSize: "28px",
  fontWeight: "700" as const,
  margin: "10px 0 12px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#000000",
  fontSize: "16px",
  lineHeight: "1.65",
  textAlign: "left" as const,
  margin: "12px 0",
};

const autoPublishBox = {
  backgroundColor: "#f0f9ff",
  border: "1px solid #0ea5e9",
  padding: "16px",
  margin: "0 0 20px",
  borderRadius: "12px",
};

const autoPublishContent = {
  width: "100%",
};

const autoPublishTitle = {
  margin: "0 0 8px",
  color: "#0c4a6e",
  fontWeight: "600" as const,
  fontSize: "15px",
};

const autoPublishText = {
  margin: "0",
  color: "#075985",
  fontSize: "14px",
  lineHeight: "1.55",
};

const eventDetailsBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #eef2f7",
  padding: "16px",
  margin: "0 0 24px",
  borderRadius: "12px",
};

const eventDetailsContent = {
  width: "100%",
};

const eventDetailRow = {
  marginBottom: "12px",
};

const eventDetailRowLast = {
  marginBottom: "0",
};

const detailLabel = {
  width: "140px",
  paddingRight: "16px",
};

const detailLabelText = {
  margin: "0",
  fontSize: "14px",
  fontWeight: "600" as const,
  color: "#000000",
};

const detailValue = {
  flex: 1,
};

const detailValueText = {
  margin: "0",
  fontSize: "15px",
  color: "#333333",
};

const detailValueCode = {
  margin: "0",
  fontSize: "13px",
  color: "#000000",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

const buttonContainer = {
  padding: "16px 0 24px",
  textAlign: "center" as const,
};

const label = {
  color: "#000000",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 6px 0",
};

const smallText = {
  color: "#333333",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "0 0 8px 0",
};

const link = {
  color: "#16A34A",
  fontSize: "13px",
  fontWeight: "500" as const,
  textDecoration: "underline",
  wordBreak: "break-all" as const,
};

const gettingStarted = {
  marginTop: "24px",
  paddingTop: "16px",
  borderTop: "1px solid #eef2f7",
};

const helpText = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};
