import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Link,
} from "@react-email/components";
import * as React from "react";
import EmailHeader from "./_components/EmailHeader";

interface ProjectCancellationProps {
  volunteerName: string;
  projectName: string;
  cancellationReason?: string;
}

export default function ProjectCancellation({
  volunteerName = "John Doe",
  projectName = "Beach Cleanup Drive",
  cancellationReason = "Due to unforeseen weather conditions, we need to cancel this event for the safety of all volunteers.",
}: ProjectCancellationProps) {
  const currentYear = new Date().getFullYear();

  return (
    <Html lang="en">
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={headingRed}>Project cancelled</Heading>
              <Text style={paragraph}>Hi {volunteerName},</Text>
              <Text style={paragraph}>
                We’re sorry—<strong>{projectName}</strong> has been cancelled.
              </Text>

              {cancellationReason ? (
                <Section style={reasonBox}>
                  <Text style={reasonLabel}>Reason for cancellation</Text>
                  <Text style={reasonText}>{cancellationReason}</Text>
                </Section>
              ) : (
                <Section style={subtleBox}>
                  <Text style={label}>Update</Text>
                  <Text style={smallText}>
                    The organizers have cancelled this project. We’ll share more details if they become available.
                  </Text>
                </Section>
              )}

              <Section style={subtleBox}>
                <Text style={label}>We’re here if you need us</Text>
                <Text style={smallText}>
                  We sincerely apologize for any inconvenience this may cause. If you have questions, reply to this email or
                  contact{" "}
                  <Link href="mailto:support@lets-assist.com" style={link}>
                    support@lets-assist.com
                  </Link>
                  .
                </Text>
              </Section>

              <Section style={encouragementBox}>
                <Text style={encouragementText}>
                  Thank you for your commitment to volunteering. We hope to see you in future projects.
                </Text>
              </Section>
            </Section>

            <Section style={footerBox}>
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
  padding: "8px 24px 16px",
};

const headingRed = {
  color: "#b91c1c",
  fontSize: "24px",
  fontWeight: "700" as const,
  margin: "10px 0 12px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.65",
  textAlign: "left" as const,
  margin: "12px 0",
};

const reasonBox = {
  padding: "14px 14px",
  margin: "14px 0 0",
  backgroundColor: "#fef2f2",
  border: "1px solid #fee2e2",
};

const reasonLabel = {
  color: "#991b1b",
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

const encouragementBox = {
  padding: "14px 14px",
  margin: "14px 0 0",
  backgroundColor: "#f0fdf4",
  border: "1px solid #dcfce7",
};

const encouragementText = {
  color: "#166534",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};

const footerBox = {
  padding: "14px 24px 18px",
  backgroundColor: "#f9fafb",
  borderTop: "1px solid #eef2f7",
};

const footerText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "6px 0",
  textAlign: "center" as const,
};

const subtleBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #eef2f7",
  padding: "14px 14px",
  margin: "14px 0 0",
};

const label = {
  color: "#111827",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 10px 0",
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "6px 0",
};

const link = {
  color: "#16a34a",
  textDecoration: "none",
  fontWeight: "600" as const,
};
