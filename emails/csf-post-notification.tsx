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
} from "react-email";
import * as React from "react";
import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";

interface CsfPostNotificationProps {
  chapterName: string;
  audienceLabel: string;
  postTitle: string;
  /**
   * Sanitized plain-text paragraphs of the post body. The campaign pipeline
   * strips rich text server-side BEFORE the campaign content digest is frozen;
   * this template never receives or embeds raw HTML.
   */
  postParagraphs: string[];
  postUrl: string;
  /**
   * Recipient-facing unsubscribe page for this chapter's announcement topic.
   * The campaign body is byte-identical for every recipient, so this is the
   * same organization+topic URL for everyone — the page itself verifies the
   * address before recording an opt-out.
   */
  unsubscribeUrl: string;
  publishedAtLabel: string;
}

export default function CsfPostNotification({
  chapterName = "DVHS CSF",
  audienceLabel = "Class of 2028",
  postTitle = "New volunteering opportunity",
  postParagraphs = [
    "We just posted a new opportunity in your class feed.",
    "Open Let's Assist for the details and to sign up.",
  ],
  postUrl = "https://lets-assist.com/organization/dvhs-csf",
  unsubscribeUrl = "https://lets-assist.com/unsubscribe/csf/org/announcements",
  publishedAtLabel = "August 6, 2026",
}: CsfPostNotificationProps) {
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
            }
          `}
        </style>
      </Head>
      <Preview>
        {chapterName}: {postTitle}
      </Preview>
      <Body style={main}>
        <Container style={container} className="container">
          <Section style={card} className="card">
            <EmailHeader />

            <Section style={content} className="content">
              <Text style={audienceChip}>
                {chapterName} • {audienceLabel}
              </Text>
              <Heading style={heading1}>{postTitle}</Heading>
              <Text style={metaText}>Posted {publishedAtLabel}</Text>

              {postParagraphs.map((paragraph, index) => (
                <Text key={index} style={paragraphStyle}>
                  {paragraph}
                </Text>
              ))}

              <Section style={buttonContainer}>
                <EmailButton href={postUrl}>View in Let's Assist</EmailButton>
              </Section>

              <Section style={linkSection}>
                <Text style={smallText}>
                  Having trouble with the button? Copy and paste this link into
                  your browser:
                </Text>
                <Text style={linkText}>
                  <Link href={postUrl} style={link}>
                    {postUrl}
                  </Link>
                </Text>
              </Section>

              <Section style={unsubscribeSection}>
                <Text style={smallText}>
                  You're receiving this because you're part of {chapterName} on
                  Let's Assist.{" "}
                  <Link href={unsubscribeUrl} style={link}>
                    Unsubscribe from announcement emails
                  </Link>
                  .
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

const audienceChip = {
  color: "#166534",
  backgroundColor: "#f0fdf4",
  display: "inline-block",
  fontSize: "12px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  padding: "4px 10px",
  borderRadius: "9999px",
  margin: "10px 0 0",
};

const heading1 = {
  color: "#000000",
  fontSize: "26px",
  fontWeight: "700" as const,
  margin: "12px 0 4px",
  padding: "0",
  letterSpacing: "-0.02em",
};

const metaText = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0 0 16px",
};

const paragraphStyle = {
  color: "#000000",
  fontSize: "16px",
  lineHeight: "1.65",
  textAlign: "left" as const,
  margin: "12px 0",
  whiteSpace: "pre-wrap" as const,
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

const unsubscribeSection = {
  marginTop: "16px",
  paddingTop: "16px",
  borderTop: "1px solid #eef2f7",
};
