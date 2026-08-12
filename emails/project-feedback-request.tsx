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
} from "react-email";
import * as React from "react";
import EmailButton from "./_components/EmailButton";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";

/**
 * The post-project follow-up. One per attendee per project, sent by the
 * project-feedback-followups worker after hours publish (or the 96h
 * backstop).
 *
 * The five star links deep-link with ?rating=N as a PRE-SELECTION only —
 * the landing page still requires a submit press, because link prefetchers
 * and mail scanners follow GETs.
 */

interface ProjectFeedbackRequestProps {
  volunteerName: string;
  projectTitle: string;
  organizationName?: string | null;
  feedbackUrl: string;
  unsubscribeUrl: string;
  eventDate?: string | null;
}

export default function ProjectFeedbackRequest({
  volunteerName = "Volunteer",
  projectTitle = "Beach Cleanup Drive",
  organizationName = null,
  feedbackUrl = "https://lets-assist.com/feedback/req-123?token=abc",
  unsubscribeUrl = "https://lets-assist.com/feedback/req-123/unsubscribe?token=abc",
  eventDate = null,
}: ProjectFeedbackRequestProps) {
  const separator = feedbackUrl.includes("?") ? "&" : "?";

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
              <Heading style={heading1}>
                How did volunteering at {projectTitle} go?
              </Heading>
              <Text style={paragraph}>Hi {volunteerName},</Text>
              <Text style={paragraph}>
                You volunteered at <strong>{projectTitle}</strong>
                {organizationName ? ` with ${organizationName}` : ""}
                {eventDate ? ` on ${eventDate}` : ""}. We&apos;d love to hear
                how it went — tap a star to answer in a few seconds:
              </Text>

              <Row style={starsRow}>
                <Column align="center">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Link
                      key={value}
                      href={`${feedbackUrl}${separator}rating=${value}`}
                      style={starLink}
                      aria-label={`${value} star${value > 1 ? "s" : ""}`}
                    >
                      ★
                    </Link>
                  ))}
                </Column>
              </Row>

              <Row style={buttonContainer}>
                <Column>
                  <EmailButton href={feedbackUrl}>
                    Share how it went
                  </EmailButton>
                </Column>
              </Row>

              <Text style={smallText}>
                Your feedback goes only to the project organizer — it&apos;s
                never shown publicly.
              </Text>

              <Text style={footnote}>
                Don&apos;t want these follow-ups?{" "}
                <Link style={link} href={unsubscribeUrl}>
                  Unsubscribe
                </Link>
                .
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

const starsRow = {
  padding: "10px 0 0",
};

const starLink = {
  color: "#f59e0b",
  fontSize: "34px",
  textDecoration: "none",
  padding: "0 6px",
};

const buttonContainer = {
  padding: "14px 0 6px",
  textAlign: "center" as const,
};

const smallText = {
  color: "#333333",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "14px 0 8px",
};

const footnote = {
  color: "#777777",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: "16px 0 0",
};

const link = {
  color: "#16A34A",
  fontSize: "12px",
  fontWeight: "500" as const,
  textDecoration: "underline",
};
