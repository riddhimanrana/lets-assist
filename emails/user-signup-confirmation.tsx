import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Row,
  Column,
  Link,
} from "@react-email/components";
import * as React from "react";
import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";

interface UserSignupConfirmationProps {
  projectName: string;
  userName: string;
  projectDate: string;
  projectTime: string;
  projectLocation: string;
  projectUrl: string;
}

export default function UserSignupConfirmation({
  projectName = "Beach Cleanup Drive",
  userName = "John Doe",
  projectDate = "January 15, 2026",
  projectTime = "9:00 AM - 12:00 PM",
  projectLocation = "Ocean Beach Park, 123 Beach Rd",
  projectUrl = "https://lets-assist.com/projects/123",
}: UserSignupConfirmationProps) {
  const currentYear = new Date().getFullYear();

  return (
    <Html lang="en">
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            {/* Header */}
            <Section style={content}>
              <Heading style={heading1}>You're signed up</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>
                Your signup for <strong>{projectName}</strong> is confirmed. We’re excited to have you!
              </Text>

              {/* Event Details */}
              <Section style={detailsBox}>
                <Text style={label}>Event details</Text>
                <Row style={detailRow}>
                  <Column style={detailLabelCol}>
                    <Text style={detailLabelText}>Project</Text>
                  </Column>
                  <Column style={detailValueCol}>
                    <Text style={detailValueText}>{projectName}</Text>
                  </Column>
                </Row>
                <Row style={detailRow}>
                  <Column style={detailLabelCol}>
                    <Text style={detailLabelText}>Date</Text>
                  </Column>
                  <Column style={detailValueCol}>
                    <Text style={detailValueText}>{projectDate}</Text>
                  </Column>
                </Row>
                {projectTime && (
                  <Row style={detailRow}>
                    <Column style={detailLabelCol}>
                      <Text style={detailLabelText}>Time</Text>
                    </Column>
                    <Column style={detailValueCol}>
                      <Text style={detailValueText}>{projectTime}</Text>
                    </Column>
                  </Row>
                )}
                <Row style={detailRowLast}>
                  <Column style={detailLabelCol}>
                    <Text style={detailLabelText}>Location</Text>
                  </Column>
                  <Column style={detailValueCol}>
                    <Text style={detailValueText}>{projectLocation}</Text>
                  </Column>
                </Row>
              </Section>

              {/* CTA Button */}
              <Section style={buttonContainer}>
                <EmailButton href={projectUrl}>View project details</EmailButton>
              </Section>

              {/* What's Next */}
              <Section style={subtleBox}>
                <Text style={label}>What’s next?</Text>
                <Text style={smallText}>• Add the event to your calendar</Text>
                <Text style={smallText}>• Watch for updates from the organizer</Text>
                <Text style={smallText}>• Check the project page for any changes</Text>
              </Section>
            </Section>

            {/* Footer */}
            <Section style={footerBox}>
              <Text style={footerText}>
                Questions? Reply to this email or contact{" "}
                <a href="mailto:support@lets-assist.com" style={footerLink}>
                  support@lets-assist.com
                </a>
                .
              </Text>
              <Text style={footerText}>© {currentYear} Riddhiman Rana. All rights reserved.</Text>
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
  border: "1px solid #e5e7eb",
};

const content = {
  padding: "20px 16px 14px",
};

const heading1 = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  margin: "0 0 14px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "1.6",
  textAlign: "left" as const,
  margin: "0 0 16px",
};

const label = {
  color: "#111827",
  fontSize: "13px",
  fontWeight: "700" as const,
  margin: "0 0 12px 0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const detailsBox = {
  margin: "14px 0 0",
  backgroundColor: "#f8f9fa",
  padding: "16px",
  borderLeft: "4px solid #16a34a",
};

const detailRow = {
  marginBottom: "12px",
};

const detailRowLast = {
  marginBottom: "0",
};

const detailLabelCol = {
  width: "35%",
  paddingRight: "12px",
};

const detailLabelText = {
  margin: "0",
  fontSize: "13px",
  fontWeight: "600" as const,
  color: "#374151",
};

const detailValueCol = {
  width: "65%",
};

const detailValueText = {
  margin: "0",
  fontSize: "13px",
  color: "#555555",
  lineHeight: "1.5",
};

const buttonContainer = {
  paddingTop: "16px",
  paddingBottom: "8px",
  textAlign: "center" as const,
};

const footerBox = {
  padding: "14px 16px 16px",
  backgroundColor: "#f9fafb",
  borderTop: "1px solid #eef2f7",
};

const footerText = {
  color: "#6b7280",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "5px 0",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#16a34a",
  textDecoration: "none",
  fontWeight: "600" as const,
};

const subtleBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #eef2f7",
  padding: "12px 12px",
  margin: "16px 0 0",
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "5px 0",
};
