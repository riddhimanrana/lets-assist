import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

import type { AccountAccessStatus } from "@/lib/auth/account-access";

import EmailButton from "./_components/EmailButton";
import EmailFooter from "./_components/EmailFooter";
import EmailHeader from "./_components/EmailHeader";

interface AccountAccessUpdateEmailProps {
  userName?: string;
  status: AccountAccessStatus;
  reason?: string | null;
  banDuration?: string | null;
  supportUrl?: string;
}

function getCopy(status: AccountAccessStatus) {
  if (status === "banned") {
    return {
      heading: "Your account has been banned",
      preview: "Your Let's Assist account has been banned",
      intro:
        "Your account can no longer access Let’s Assist due to a serious policy violation.",
      color: "#7f1d1d",
      boxBackground: "#fef2f2",
      boxBorder: "1px solid #fecaca",
    };
  }

  return {
    heading: "Your account access has been restored",
    preview: "Your Let's Assist account access has been restored",
    intro: "Good news — your account access has been fully restored.",
    color: "#14532d",
    boxBackground: "#f0fdf4",
    boxBorder: "1px solid #bbf7d0",
  };
}

export default function AccountAccessUpdateEmail({
  userName = "there",
  status,
  reason,
  banDuration,
  supportUrl = "https://lets-assist.com/help",
}: AccountAccessUpdateEmailProps) {
  const copy = getCopy(status);

  return (
    <Html lang="en">
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={heading}>{copy.heading}</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>{copy.intro}</Text>

              <Section
                style={{
                  ...statusBox,
                  backgroundColor: copy.boxBackground,
                  border: copy.boxBorder,
                }}
              >
                <Text style={label}>Status</Text>
                <Text style={{ ...statusValue, color: copy.color }}>
                  {status === "banned" ? "Banned" : "Active"}
                </Text>

                {status === "banned" && banDuration ? (
                  <>
                    <Text style={{ ...label, marginTop: 12 }}>Duration</Text>
                    <Text style={reasonText}>{banDuration}</Text>
                  </>
                ) : null}

                {reason ? (
                  <>
                    <Text style={{ ...label, marginTop: 12 }}>Reason</Text>
                    <Text style={reasonText}>{reason}</Text>
                  </>
                ) : null}
              </Section>

              <Text style={smallText}>
                If you think this was applied in error, contact support and include any relevant
                details so our team can review your case.
              </Text>

              <Section style={buttonWrap}>
                <EmailButton href={supportUrl}>Contact support</EmailButton>
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

const heading = {
  color: "#111827",
  fontSize: "28px",
  fontWeight: "700" as const,
  margin: "10px 0 12px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#111827",
  fontSize: "16px",
  lineHeight: "1.65",
  textAlign: "left" as const,
  margin: "12px 0",
};

const statusBox = {
  padding: "16px",
  margin: "14px 0 0",
  borderRadius: "12px",
};

const label = {
  color: "#111827",
  fontSize: "13px",
  fontWeight: "700" as const,
  margin: "0 0 4px 0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

const statusValue = {
  fontSize: "18px",
  fontWeight: "700" as const,
  margin: "0",
};

const reasonText = {
  color: "#1f2937",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};

const smallText = {
  color: "#374151",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "16px 0 0",
};

const buttonWrap = {
  padding: "18px 0 10px",
  textAlign: "center" as const,
};
