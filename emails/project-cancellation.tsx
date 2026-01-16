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
import EmailFooter from "./_components/EmailFooter";

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
              <Heading style={headingRed}>Project cancelled</Heading>
              <Text style={paragraph}>Hi {volunteerName},</Text>
              <Text style={paragraph}>
                We’re sorry, the project <strong>{projectName}</strong> you signed up for has been cancelled.
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

              {/* <Section style={subtleBox}>
                <Text style={label}>We’re here if you need us</Text>
                <Text style={smallText}>
                  We sincerely apologize for any inconvenience this may cause. If you have questions, reply to this email or
                  contact{" "}
                  <Link href="mailto:support@lets-assist.com" style={link}>
                    support@lets-assist.com
                  </Link>
                  .
                </Text>
              </Section> */}

              <Section style={encouragementBox}>
                <Text style={encouragementText}>
                  Thank you for your commitment to volunteering. We hope to see you in future projects.
                </Text>
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

const headingRed = {
  color: "#b91c1c",
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

const reasonBox = {
  padding: "16px",
  margin: "14px 0 0",
  backgroundColor: "#fef2f2",
  border: "1px solid #fee2e2",
  borderRadius: "12px",
};

const reasonLabel = {
  color: "#b91c1c",
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
  padding: "16px",
  margin: "14px 0 0",
  backgroundColor: "#f0fdf4",
  border: "1px solid #dcfce7",
  borderRadius: "12px",
};

const encouragementText = {
  color: "#166534",
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

const label = {
  color: "#000000",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 10px 0",
};

const smallText = {
  color: "#333333",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "6px 0",
};

const link = {
  color: "#16A34A",
  fontSize: "13px",
  fontWeight: "500" as const,
  textDecoration: "underline",
  wordBreak: "break-all" as const,
};
