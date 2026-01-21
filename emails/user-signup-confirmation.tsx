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
  Preview,
} from "@react-email/components";
import * as React from "react";
import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";

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
  return (
    <Html lang="en">
      <Head>
        <style>
          {`
            @media only screen and (max-width: 600px) {
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
                box-shadow: none !important;
              }
              .detailsBox {
                padding: 12px !important;
              }
              .detailLabelCol {
                width: 100% !important;
                display: block !important;
                padding-right: 0 !important;
                margin-bottom: 4px !important;
              }
              .detailValueCol {
                width: 100% !important;
                display: block !important;
              }
            }
          `}
        </style>
      </Head>
      <Preview>You're signed up for {projectName}</Preview>
      <Body style={main}>
        <Container style={container} className="container">
          <Section style={card} className="card">
            <EmailHeader />

            {/* Header */}
            <Section style={content} className="content">
              <Heading style={heading1}>You're signed up</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>
                Your signup for <strong>{projectName}</strong> is confirmed. We&apos;re excited to have
                you!
              </Text>

              {/* Event Details */}
              <Section style={detailsBox} className="detailsBox">
                <Text style={label}>Event details</Text>
                <Row style={detailRow}>
                  <Column style={detailLabelCol} className="detailLabelCol">
                    <Text style={detailLabelText}>Project</Text>
                  </Column>
                  <Column style={detailValueCol} className="detailValueCol">
                    <Text style={detailValueText}>{projectName}</Text>
                  </Column>
                </Row>
                <Row style={detailRow}>
                  <Column style={detailLabelCol} className="detailLabelCol">
                    <Text style={detailLabelText}>Date</Text>
                  </Column>
                  <Column style={detailValueCol} className="detailValueCol">
                    <Text style={detailValueText}>{projectDate}</Text>
                  </Column>
                </Row>
                {projectTime && (
                  <Row style={detailRow}>
                    <Column style={detailLabelCol} className="detailLabelCol">
                      <Text style={detailLabelText}>Time</Text>
                    </Column>
                    <Column style={detailValueCol} className="detailValueCol">
                      <Text style={detailValueText}>{projectTime}</Text>
                    </Column>
                  </Row>
                )}
                <Row style={detailRowLast}>
                  <Column style={detailLabelCol} className="detailLabelCol">
                    <Text style={detailLabelText}>Location</Text>
                  </Column>
                  <Column style={detailValueCol} className="detailValueCol">
                    <Text style={detailValueText}>{projectLocation}</Text>
                  </Column>
                </Row>
              </Section>

              {/* Action */}
              <Section style={buttonContainer}>
                <EmailButton href={projectUrl}>View project details</EmailButton>
              </Section>

              <Section style={gettingStarted}>
                <Text style={label}>Having trouble with the button?</Text>
                <Text style={smallText}>
                  You can also use this direct link:{" "}
                  <Link style={link} href={projectUrl}>
                    {projectUrl}
                  </Link>
                </Text>
              </Section>

              {/* What's Next */}
              {/* <Section style={subtleBox}>
                <Text style={{ ...label, textTransform: "none", letterSpacing: "normal" }}>What's next?</Text>
                <Text style={smallText}>• Add the event to your calendar</Text>
                <Text style={smallText}>• Watch for updates from the organizer</Text>
                <Text style={smallText}>• Check the project page for any changes</Text>
              </Section> */}
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

const label = {
  color: "#000000",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 6px 0",
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

const gettingStarted = {
  marginTop: "24px",
  paddingTop: "16px",
  borderTop: "1px solid #eef2f7",
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
