import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Link,
  Row,
  Column,
} from "@react-email/components";
import * as React from "react";
import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";

interface AnonymousSignupConfirmationProps {
  confirmationUrl: string;
  projectName: string;
  userName: string;
  anonymousProfileUrl: string;
}

export default function AnonymousSignupConfirmation({
  confirmationUrl = "https://lets-assist.com/confirm/123",
  projectName = "Beach Cleanup Drive",
  userName = "Volunteer",
  anonymousProfileUrl = "https://lets-assist.com/anonymous/abc123",
}: AnonymousSignupConfirmationProps) {
  const currentYear = new Date().getFullYear();

  return (
    <Html lang="en">
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={heading1}>Confirm your signup</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>
                Thanks for signing up to volunteer for <strong>{projectName}</strong>. Please confirm your email to complete your registration.
              </Text>

              <Row style={buttonContainer}>
                <Column>
                  <EmailButton href={confirmationUrl}>Confirm your signup</EmailButton>
                </Column>
              </Row>

              <Section style={subtleBox}>
                <Row>
                  <Column>
                    <Text style={label}>Having trouble with the button?</Text>
                    <Text style={smallText}>Copy and paste this link:</Text>
                    <Link style={link} href={confirmationUrl}>
                      {confirmationUrl}
                    </Link>
                  </Column>
                </Row>
              </Section>

              <Section style={infoBox}>
                <Row>
                  <Column>
                    <Text style={infoTitle}>Your anonymous profile</Text>
                    <Text style={smallText}>
                      We've created a profile for you to track volunteer hours and certificates.
                    </Text>
                    <Link style={link} href={anonymousProfileUrl}>
                      {anonymousProfileUrl}
                    </Link>
                  </Column>
                </Row>
              </Section>
            </Section>

            <Section style={footerBox}>
              <Row>
                <Column>
                  <Text style={footerText}>
                    This confirmation link expires in 24 hours. If you didn't sign up for this project, you can safely ignore this email.
                  </Text>
                  <Text style={footerText}>
                    Need help? Email{" "}
                    <Link href="mailto:support@lets-assist.com" style={footerLink}>
                      support@lets-assist.com
                    </Link>
                    .
                  </Text>
                  <Text style={footerText}>© {currentYear} Riddhiman Rana. All rights reserved.</Text>
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
  border: "1px solid #e5e7eb",
};

const content = {
  padding: "8px 24px 8px",
};

const heading1 = {
  color: "#111827",
  fontSize: "26px",
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

const buttonContainer = {
  padding: "18px 0 10px",
  textAlign: "center" as const,
};

const link = {
  color: "#16a34a",
  textDecoration: "none",
  fontSize: "14px",
  wordBreak: "break-all" as const,
};

const label = {
  color: "#111827",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 6px 0",
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "0 0 8px 0",
};

const subtleBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #eef2f7",
  padding: "14px 14px",
  margin: "16px 0 0",
};

const infoBox = {
  backgroundColor: "#f0fdf4",
  border: "1px solid #dcfce7",
  padding: "14px 14px",
  margin: "14px 0 8px",
};

const infoTitle = {
  color: "#166534",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 6px 0",
};

const footerBox = {
  padding: "16px 24px 20px",
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

const footerLink = {
  color: "#16a34a",
  textDecoration: "none",
  fontWeight: "600" as const,
};
