import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Preview,
  Link,
} from "@react-email/components";
import * as React from "react";
import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";

interface OrganizationInvitationProps {
  organizationName: string;
  organizationUsername: string;
  inviterName: string;
  role: "staff" | "member";
  inviteUrl: string;
  expiresAt: string;
}

export default function OrganizationInvitation({
  organizationName = "Acme Organization",
  organizationUsername = "acme-org",
  inviterName = "John Doe",
  role = "member",
  inviteUrl = "https://lets-assist.com/organization/join/invite?token=abc123",
  expiresAt = "April 11, 2026",
}: OrganizationInvitationProps) {
  const roleDisplay = role === "staff" ? "Staff Member" : "Member";
  const roleDescription =
    role === "staff"
      ? "As a staff member, you'll have elevated permissions including the ability to verify volunteer hours and help manage organization activities."
      : "As a member, you'll be able to participate in volunteer opportunities and track your community service hours.";

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
              .roleBox {
                padding: 12px !important;
              }
            }
          `}
        </style>
      </Head>
      <Preview>
        You've been invited to join {organizationName} as a {roleDisplay.toLowerCase()}
      </Preview>
      <Body style={main}>
        <Container style={container} className="container">
          <Section style={card} className="card">
            <EmailHeader />

            {/* Content */}
            <Section style={content} className="content">
              <Heading style={heading1}>You're Invited!</Heading>
              <Text style={paragraph}>
                <strong>{inviterName}</strong> has invited you to join{" "}
                <strong>{organizationName}</strong> on Let's Assist.
              </Text>

              {/* Role Box */}
              <Section style={roleBox} className="roleBox">
                <Text style={roleLabel}>Your Role</Text>
                <Text style={roleValue}>{roleDisplay}</Text>
                <Text style={roleDescriptionStyle}>{roleDescription}</Text>
              </Section>

              <Text style={paragraph}>
                Click the button below to accept your invitation and get started.
              </Text>

              {/* Action Button */}
              <Section style={buttonContainer}>
                <EmailButton href={inviteUrl}>Accept Invitation</EmailButton>
              </Section>

              {/* Link fallback */}
              <Section style={linkSection}>
                <Text style={smallText}>
                  Having trouble with the button? Copy and paste this link into your browser:
                </Text>
                <Text style={linkText}>
                  <Link href={inviteUrl} style={link}>
                    {inviteUrl}
                  </Link>
                </Text>
              </Section>

              {/* Expiration notice */}
              <Section style={noticeBox}>
                <Text style={noticeText}>
                  ⏰ This invitation expires on <strong>{expiresAt}</strong>. Please accept it before then.
                </Text>
              </Section>

              {/* Info about the organization */}
              <Section style={infoSection}>
                <Text style={infoLabel}>About {organizationName}</Text>
                <Text style={infoText}>
                  Visit the organization page to learn more:{" "}
                  <Link
                    href={`https://lets-assist.com/organization/${organizationUsername}`}
                    style={link}
                  >
                    lets-assist.com/organization/{organizationUsername}
                  </Link>
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

const roleBox = {
  margin: "20px 0",
  backgroundColor: "#f0fdf4",
  padding: "20px",
  borderLeft: "4px solid #16A34A",
  borderRadius: "12px",
};

const roleLabel = {
  color: "#166534",
  fontSize: "12px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 4px 0",
};

const roleValue = {
  color: "#15803d",
  fontSize: "24px",
  fontWeight: "700" as const,
  margin: "0 0 8px 0",
};

const roleDescriptionStyle = {
  color: "#166534",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0",
};

const buttonContainer = {
  padding: "24px 0 16px",
  textAlign: "center" as const,
};

const linkSection = {
  marginTop: "16px",
  paddingTop: "16px",
  borderTop: "1px solid #eef2f7",
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "0 0 8px 0",
};

const linkText = {
  margin: "0",
  wordBreak: "break-all" as const,
};

const link = {
  color: "#16A34A",
  fontSize: "13px",
  fontWeight: "500" as const,
  textDecoration: "underline",
};

const noticeBox = {
  margin: "24px 0",
  backgroundColor: "#fffbeb",
  padding: "12px 16px",
  borderRadius: "8px",
  border: "1px solid #fde68a",
};

const noticeText = {
  color: "#92400e",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0",
};

const infoSection = {
  marginTop: "24px",
  paddingTop: "20px",
  borderTop: "1px solid #eef2f7",
};

const infoLabel = {
  color: "#000000",
  fontSize: "14px",
  fontWeight: "600" as const,
  margin: "0 0 8px 0",
};

const infoText = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};
