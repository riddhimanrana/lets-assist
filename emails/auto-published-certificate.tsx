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
  Img,
} from "@react-email/components";
import * as React from "react";

import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";

interface AutoPublishedCertificateProps {
  volunteerName: string;
  projectTitle: string;
  certificateId: string;
  certificateUrl: string;
  eventStart?: string;
  eventEnd?: string;
  timezone?: string;
}

export default function AutoPublishedCertificate({
  volunteerName = "John Doe",
  projectTitle = "Beach Cleanup Drive",
  certificateId = "CERT-2026-001",
  certificateUrl = "https://lets-assist.com/certificates/cert-123",
  eventStart,
  eventEnd,
  timezone,
}: AutoPublishedCertificateProps) {
  const currentYear = new Date().getFullYear();

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
      });

      const endTime = end.toLocaleTimeString("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

      return `${startTime} - ${endTime}`;
    } catch {
      return undefined;
    }
  })();

  return (
    <Html lang="en">
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={heading1}>Your Certificate is Ready!</Heading>

              <Text style={paragraph}>Hi {volunteerName},</Text>

              <Text style={paragraph}>
                Your volunteer certificate for <strong>{projectTitle}</strong> has been automatically published and is now ready for download.
              </Text>

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

                    {eventDateStr && (
                      <Row style={eventDetailRow}>
                        <Column style={detailLabel}>
                          <Text style={detailLabelText}>Date</Text>
                        </Column>
                        <Column style={detailValue}>
                          <Text style={detailValueText}>{eventDateStr}</Text>
                        </Column>
                      </Row>
                    )}

                    {eventTimeStr && (
                      <Row style={eventDetailRow}>
                        <Column style={detailLabel}>
                          <Text style={detailLabelText}>Time</Text>
                        </Column>
                        <Column style={detailValue}>
                          <Text style={detailValueText}>{eventTimeStr}</Text>
                        </Column>
                      </Row>
                    )}

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

              <Row style={buttonContainer}>
                <Column>
                  <EmailButton href={certificateUrl}>Download Certificate</EmailButton>
                </Column>
              </Row>

              <Text style={helpText}>
                Your certificate is official recognition of your volunteer contribution. You can download, print, and share it anytime.
              </Text>

              <Section style={gettingStarted}>
                <Heading style={gettingStartedTitle}>Having trouble with the button?</Heading>
                <Text style={helpText}>
                  You can also use this direct link:{" "}
                  <Link style={alternativeLink} href={certificateUrl}>
                    {certificateUrl}
                  </Link>
                </Text>
              </Section>
            </Section>

            <Section style={footerBox}>
              <Row>
                <Column>
                  <Text style={footerText}>© {currentYear} Riddhiman Rana. All rights reserved.</Text>
                  <Text style={footerText}>
                    Questions? Contact us at{" "}
                    <Link href="mailto:support@lets-assist.com" style={footerLink}>
                      support@lets-assist.com
                    </Link>
                  </Text>
                </Column>
              </Row>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f9f9f9",
  fontFamily:
    "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
};

const container = {
  margin: "0 auto",
  padding: "32px 16px 48px",
  maxWidth: "600px",
};

const card = {
  backgroundColor: "#ffffff",
  border: "1px solid #f0f0f0",
};

const content = {
  padding: "24px 24px 18px",
};

const heading1 = {
  color: "#222222",
  fontSize: "28px",
  fontWeight: "700" as const,
  margin: "0 0 20px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#555555",
  fontSize: "16px",
  lineHeight: "1.6",
  textAlign: "left" as const,
  margin: "0 0 20px",
};

const autoPublishBox = {
  backgroundColor: "#f0f9ff",
  border: "1px solid #0ea5e9",
  padding: "16px",
  margin: "0 0 20px",
};

const autoPublishContent = {
  width: "100%",
};

const autoPublishTitle = {
  margin: "0 0 8px",
  color: "#0369a1",
  fontWeight: "600" as const,
  fontSize: "15px",
};

const autoPublishText = {
  margin: "0",
  color: "#0369a1",
  fontSize: "14px",
  lineHeight: "1.55",
};

const eventDetailsBox = {
  backgroundColor: "#f8f9fa",
  padding: "20px",
  margin: "0 0 24px",
  borderLeft: "4px solid #16a34a",
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
  color: "#374151",
};

const detailValue = {
  flex: 1,
};

const detailValueText = {
  margin: "0",
  fontSize: "15px",
  color: "#555555",
};

const detailValueCode = {
  margin: "0",
  fontSize: "13px",
  color: "#111827",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

const buttonContainer = {
  paddingBottom: "12px",
  textAlign: "center" as const,
};

const helpText = {
  color: "#777777",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const gettingStarted = {
  marginTop: "28px",
  paddingTop: "16px",
  borderTop: "1px solid #f0f0f0",
};

const gettingStartedTitle = {
  color: "#222222",
  fontSize: "15px",
  fontWeight: "700" as const,
  margin: "0 0 8px",
  padding: "0",
};

const alternativeLink = {
  wordBreak: "break-all" as const,
  color: "#16a34a",
  textDecoration: "underline",
  fontWeight: "500" as const,
};

const footerBox = {
  padding: "20px 24px",
  backgroundColor: "#f9fafb",
  borderTop: "1px solid #f0f0f0",
};

const footerText = {
  color: "#777777",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "6px 0",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#16a34a",
  textDecoration: "none",
  fontWeight: "500" as const,
};
