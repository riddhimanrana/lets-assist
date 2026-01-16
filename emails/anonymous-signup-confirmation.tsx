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
import EmailFooter from "./_components/EmailFooter";

interface AnonymousSignupConfirmationProps {
  confirmationUrl: string;
  projectName: string;
  userName: string;
  anonymousProfileUrl: string;
  projectDate: string;
  projectTime: string;
  slotLabel: string;
}

export default function AnonymousSignupConfirmation({
  confirmationUrl = "https://lets-assist.com/confirm/123",
  projectName = "Beach Cleanup Drive",
  userName = "Volunteer",
  anonymousProfileUrl = "https://lets-assist.com/anonymous/abc123",
  projectDate = "January 15, 2026",
  projectTime = "9:00 AM - 12:00 PM",
  slotLabel = "Slot 1",
}: AnonymousSignupConfirmationProps) {
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
              <Heading style={heading1}>Confirm your signup</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>
                Thanks for signing up to volunteer for <strong>{projectName}</strong>. Please confirm your email to complete your registration.
              </Text>

              <Section style={detailsBox}>
                <Text style={label}>Signup details</Text>
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
                <Row style={detailRow}>
                  <Column style={detailLabelCol}>
                    <Text style={detailLabelText}>Time</Text>
                  </Column>
                  <Column style={detailValueCol}>
                    <Text style={detailValueText}>{projectTime}</Text>
                  </Column>
                </Row>
                <Row style={detailRowLast}>
                  <Column style={detailLabelCol}>
                    <Text style={detailLabelText}>Slot</Text>
                  </Column>
                  <Column style={detailValueCol}>
                    <Text style={detailValueText}>{slotLabel}</Text>
                  </Column>
                </Row>
              </Section>

              <Row style={buttonContainer}>
                <Column>
                  <EmailButton href={confirmationUrl}>Confirm your signup</EmailButton>
                </Column>
              </Row>

              <Section style={gettingStarted}>
                <Text style={label}>Having trouble with the button?</Text>
                <Text style={smallText}>
                  You can also use this direct link:{" "}
                  <Link style={link} href={confirmationUrl}>
                    {confirmationUrl}
                  </Link>
                </Text>
              </Section>

              <Section style={infoBox}>
                <Text style={infoTitle}>Your anonymous profile</Text>
                <Text style={smallText}>
                  We've created a profile for you to track volunteer hours and certificates.
                </Text>
                <Link style={link} href={anonymousProfileUrl}>
                  {anonymousProfileUrl}
                </Link>
              </Section>
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

const detailsBox = {
  margin: "14px 0 0",
  backgroundColor: "#f8f9fa",
  padding: "16px",
  borderLeft: "4px solid #16A34A",
  borderRadius: "12px",
};

const detailRow = {
  marginBottom: "12px",
};

const detailRowLast = {
  marginBottom: "0",
};

const detailLabelCol = {
  width: "30%",
  paddingRight: "12px",
};

const detailLabelText = {
  margin: "0",
  fontSize: "14px",
  fontWeight: "600" as const,
  color: "#000000",
};

const detailValueCol = {
  width: "70%",
};

const detailValueText = {
  margin: "0",
  fontSize: "15px",
  color: "#333333",
  lineHeight: "1.5",
};

const buttonContainer = {
  padding: "18px 0 10px",
  textAlign: "center" as const,
};

const link = {
  color: "#16A34A",
  fontSize: "13px",
  fontWeight: "500" as const,
  textDecoration: "underline",
  wordBreak: "break-all" as const,
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

const gettingStarted = {
  marginTop: "24px",
  paddingTop: "16px",
  borderTop: "1px solid #eef2f7",
};

const infoBox = {
  backgroundColor: "#f0fdf4",
  border: "1px solid #dcfce7",
  padding: "16px",
  margin: "14px 0 8px",
  borderRadius: "12px",
};

const infoTitle = {
  color: "#166534",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 6px 0",
};
