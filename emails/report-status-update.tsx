import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Link,
  Preview,
} from "@react-email/components";
import * as React from "react";
import EmailHeader from "./_components/EmailHeader";
import EmailFooter from "./_components/EmailFooter";
import EmailButton from "./_components/EmailButton";

type ReportStatus = 'resolved' | 'dismissed';

interface ReportStatusUpdateEmailProps {
  userName: string;
  reportStatus: ReportStatus;
  reportReason: string;
  moderationNotes?: string;
  contentTitle: string;
  contentTypeLabel: string;
  contentUrl: string;
  supportUrl: string;
}

export default function ReportStatusUpdateEmail({
  userName = 'there',
  reportStatus = 'resolved',
  reportReason = 'No reason provided',
  moderationNotes,
  contentTitle = 'Reported content',
  contentTypeLabel = 'content',
  contentUrl = 'https://lets-assist.com',
  supportUrl = 'https://lets-assist.com/help',
}: ReportStatusUpdateEmailProps) {
  const isResolved = reportStatus === 'resolved';
  const previewText = isResolved
    ? 'Your report has been resolved'
    : 'Update on your submitted report';

  return (
    <Html lang="en">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <EmailHeader />

            <Section style={content}>
              <Heading style={heading}>Update on your report</Heading>
              <Text style={paragraph}>Hi {userName},</Text>
              <Text style={paragraph}>
                {isResolved
                  ? 'Thanks for helping keep Let\'s Assist safe. Your report has been resolved by our moderation team.'
                  : 'Our moderation team reviewed your report and closed it as dismissed at this time.'}
              </Text>

              <Section style={infoBox}>
                <Text style={label}>Report reason</Text>
                <Text style={value}>{reportReason}</Text>
                <Text style={label}>Reported content</Text>
                <Text style={value}>
                  {contentTypeLabel}: {contentTitle}
                </Text>
                {moderationNotes ? (
                  <>
                    <Text style={label}>Moderator notes</Text>
                    <Text style={value}>{moderationNotes}</Text>
                  </>
                ) : null}
              </Section>

              <Section style={buttonWrap}>
                <EmailButton href={contentUrl}>View reported content</EmailButton>
              </Section>

              <Text style={smallText}>
                Need help or want to follow up? Contact support at{' '}
                <Link href={supportUrl} style={link}>
                  {supportUrl}
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
  backgroundColor: '#ffffff',
  fontFamily:
    "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
};

const container = {
  margin: '0 auto',
  padding: '40px 16px 64px',
  maxWidth: '640px',
};

const card = {
  backgroundColor: '#ffffff',
};

const content = {
  padding: '8px 24px 8px',
};

const heading = {
  color: '#111827',
  fontSize: '28px',
  fontWeight: '700' as const,
  margin: '10px 0 12px',
  letterSpacing: '-0.02em',
};

const paragraph = {
  color: '#111827',
  fontSize: '16px',
  lineHeight: '1.65',
  margin: '12px 0',
};

const infoBox = {
  backgroundColor: '#f9fafb',
  border: '1px solid #eef2f7',
  borderRadius: '12px',
  padding: '16px',
  marginTop: '14px',
};

const label = {
  color: '#6b7280',
  fontSize: '12px',
  fontWeight: '700' as const,
  margin: '0 0 4px 0',
  textTransform: 'uppercase' as const,
};

const value = {
  color: '#111827',
  fontSize: '14px',
  margin: '0 0 10px 0',
  lineHeight: '1.6',
};

const buttonWrap = {
  padding: '18px 0 10px',
  textAlign: 'center' as const,
};

const smallText = {
  color: '#374151',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '8px 0',
};

const link = {
  color: '#16A34A',
  textDecoration: 'underline',
};
