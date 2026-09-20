import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Preview,
} from "react-email";
import * as React from "react";
import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";

interface CsfUnsubscribeConfirmProps {
  chapterName: string;
  confirmUrl: string;
  expiresInMinutes: number;
}

export default function CsfUnsubscribeConfirm({
  chapterName = "DVHS CSF",
  confirmUrl = "https://lets-assist.com/unsubscribe/csf/confirm?token=abc",
  expiresInMinutes = 30,
}: CsfUnsubscribeConfirmProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        Confirm your unsubscribe from {chapterName} announcements
      </Preview>
      <Body style={main}>
        <Container style={container} className="container">
          <Section style={card}>
            <EmailHeader />
            <Section style={content}>
              <Heading style={heading1}>Confirm unsubscribe</Heading>
              <Text style={paragraph}>
                Confirm to stop announcement emails from {chapterName}.
              </Text>
              <Section style={buttonContainer}>
                <EmailButton href={confirmUrl}>
                  Unsubscribe this address
                </EmailButton>
              </Section>
              <Text style={smallText}>
                This link expires in {expiresInMinutes} minutes. If you didn't
                request this, ignore this email.
              </Text>
              <Text style={smallText}>
                You'll still receive required account and membership notices.
              </Text>
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
  fontSize: "26px",
  fontWeight: "700" as const,
  margin: "10px 0 12px",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#000000",
  fontSize: "16px",
  lineHeight: "1.65",
  margin: "12px 0",
};

const buttonContainer = {
  padding: "20px 0 12px",
  textAlign: "center" as const,
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "10px 0 0",
};
