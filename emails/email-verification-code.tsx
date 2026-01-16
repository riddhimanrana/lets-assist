import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Link,
} from "@react-email/components";
import * as React from "react";

import EmailHeader from "./_components/EmailHeader";

interface EmailVerificationCodeProps {
  code: string;
  expiresInHours?: number;
}

export default function EmailVerificationCode({
  code = "123456",
  expiresInHours = 24,
}: EmailVerificationCodeProps) {
  const currentYear = new Date().getFullYear();

  return (
    <Html lang="en">
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={heading1}>Verify your email address</Heading>

              <Text style={paragraph}>
                Enter this code in Let&apos;s Assist to verify your email address:
              </Text>

              <Section style={codeBox}>
                <Text style={codeLabel}>Verification code</Text>
                <Text style={codeValue}>{code}</Text>
                <Text style={codeHelp}>This code expires in {expiresInHours} hours.</Text>
              </Section>

              <Heading style={heading2}>How to use it</Heading>
              <Text style={paragraph}>
                Copy the code above and paste it into the verification field in your account settings to complete the process.
              </Text>

              <Section style={securityBox}>
                <Text style={securityTitle}>Security &amp; privacy</Text>
                <Text style={securityItem}>• Never share this code with anyone</Text>
                <Text style={securityItem}>• Let&apos;s Assist support will never ask for your code</Text>
                <Text style={securityItem}>• Delete this email after verifying for extra safety</Text>
              </Section>

              <Text style={smallText}>
                Didn&apos;t request this? You can safely ignore this email. If you&apos;re concerned, contact{" "}
                <Link href="mailto:support@lets-assist.com" style={link}>
                  support@lets-assist.com
                </Link>
                .
              </Text>
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

const heading1 = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  margin: "10px 0 12px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const heading2 = {
  color: "#111827",
  fontSize: "16px",
  fontWeight: "700" as const,
  margin: "18px 0 8px",
  padding: "0",
};

const paragraph = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "1.65",
  textAlign: "left" as const,
  margin: "12px 0",
};

const codeBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #eef2f7",
  padding: "16px 14px",
  margin: "14px 0 16px",
  textAlign: "center" as const,
};

const codeLabel = {
  color: "#6b7280",
  fontSize: "12px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 10px",
};

const codeValue = {
  color: "#111827",
  fontSize: "34px",
  fontWeight: "700" as const,
  letterSpacing: "0.12em",
  margin: "0 0 10px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

const codeHelp = {
  color: "#9ca3af",
  fontSize: "13px",
  margin: "0",
};

const securityBox = {
  backgroundColor: "#f0fdf4",
  border: "1px solid #dcfce7",
  padding: "14px 14px",
  margin: "14px 0 0",
};

const securityTitle = {
  color: "#166534",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 8px",
};

const securityItem = {
  color: "#15803d",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "4px 0",
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "16px 0 0",
};

const link = {
  color: "#16a34a",
  textDecoration: "none",
  fontWeight: "600" as const,
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
