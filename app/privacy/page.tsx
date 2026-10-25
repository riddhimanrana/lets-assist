import React from "react";
import Link from "next/link";
import { LongFormPage } from "@/components/projects/LongFormPage";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read the privacy policy for Let's Assist to understand how we handle your data and protect your privacy.",
};

const PrivacyPage = () => {
  return (
    <LongFormPage title="Privacy Policy" meta="Last updated December 31, 2025">
      <h2>1. Introduction</h2>
      <p>
        At Let&apos;s Assist, we value your privacy. This Privacy Policy
        explains what information we collect, how we use it, and your rights
        regarding your data. We are committed to protecting your personal
        information and being transparent about our data practices.
      </p>

      <h2>2. Information we collect</h2>
      <p>We collect the following information:</p>
      <ul>
        <li>
          <strong>Personal information:</strong> Email address, name, and phone
          number (if you choose to provide it) when you create an account or
          sign up for events.
        </li>
        <li>
          <strong>Event data:</strong> Your participation in volunteering
          opportunities, including sign-ups, check-in/check-out times, and event
          attendance.
        </li>
        <li>
          <strong>Analytics data:</strong> We use PostHog to collect anonymized
          data about how you interact with our platform (page views, clicks,
          etc.) to improve our services. You can opt out of analytics in your
          account settings.
        </li>
        <li>
          <strong>Google Calendar data (optional):</strong> If you choose to
          connect your Google Calendar, we access and store encrypted tokens to
          add volunteering events to your calendar. We do not store your
          calendar contents.
        </li>
      </ul>

      <h2>3. How we use your data</h2>
      <p>We use the collected data to:</p>
      <ul>
        <li>Create and manage your account.</li>
        <li>Process your signups for volunteering opportunities.</li>
        <li>
          Manage event check-ins/check-outs and send certificates when
          applicable.
        </li>
        <li>Add events to your Google Calendar if you&apos;ve connected it.</li>
        <li>Improve our platform through anonymized analytics (PostHog).</li>
        <li>Send you important service notifications and updates.</li>
      </ul>

      <h2>4. Google integrations (optional)</h2>
      <p>
        If you choose to connect your Google account for Calendar or Sheets
        integrations:
      </p>
      <ul>
        <li>
          <strong>What we access:</strong> We request the following Google
          permissions to enable features like calendar sync and spreadsheet
          management:
          <ul>
            <li>
              <strong>
                Email and Profile (userinfo.email, userinfo.profile):
              </strong>{" "}
              To identify and link your Google account to your Let's Assist
              profile.
            </li>
            <li>
              <strong>Google Drive files (drive.file):</strong> To access only
              the specific Google Drive files you select or create through our
              app, such as spreadsheets.
            </li>
            <li>
              <strong>
                Google Sheets access via Drive Files
                (https://www.googleapis.com/auth/drive.file):
              </strong>{" "}
              To create spreadsheets and access only the spreadsheets you
              explicitly select or create through Let&apos;s Assist for
              reporting and sync workflows.
            </li>
            <li>
              <strong>
                Google Calendar
                (https://www.googleapis.com/auth/calendar.app.created):
              </strong>{" "}
              To create, update, and remove only the calendars and events
              Let&apos;s Assist creates. Existing connections that previously
              granted the full Calendar scope remain compatible while ownership
              migration is verified; we do not expand a new connection to that
              legacy scope.
            </li>
          </ul>
        </li>
        <li>
          <strong>How we use it:</strong> We use these permissions to add
          volunteering events to your calendar, manage spreadsheets for data
          import/export, and enable two-way synchronization. We store encrypted
          OAuth tokens securely and do not access other Google data.
        </li>
        <li>
          <strong>Data retention:</strong> OAuth tokens are retained only as
          long as you maintain the connection. Upon disconnection or account
          deletion, we delete tokens and associated data within 30 days.
        </li>
        <li>
          <strong>No sharing:</strong> We do not share your Google data with
          third parties. It is used only within Let's Assist.
        </li>
        <li>
          <strong>How to disconnect:</strong> You can revoke access at any time
          via your Google Account (Security → Third-party apps with account
          access) or in your Let's Assist account settings. This deletes our
          stored tokens. Events or spreadsheets already created will remain in
          your Google account unless you delete them manually.
        </li>
      </ul>
      <p>
        Our use of Google APIs complies with the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        .
      </p>

      <h2>5. Third-party services</h2>
      <p>We use the following services:</p>
      <ul>
        <li>
          <strong>Supabase:</strong> Secure database hosting and management.
        </li>
        <li>
          <strong>PostHog:</strong> Optional analytics to improve our platform.
          You can opt out in your settings.
        </li>
      </ul>
      <p>
        These services have their own privacy policies. We do not share your
        personal data with these services beyond what is necessary for them to
        operate (e.g., Supabase stores your data, PostHog only receives
        anonymized usage information).
      </p>

      <h2>6. Data security</h2>
      <p>
        We implement strict security measures to protect your personal data from
        unauthorized access, loss, or misuse. However, no system is completely
        secure, and we cannot guarantee absolute protection. We encourage users
        to take precautions, such as using strong passwords and being mindful of
        data sharing.
      </p>

      <h2>7. Your rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access the personal data we have about you.</li>
        <li>Request corrections or deletions of inaccurate information.</li>
        <li>Opt out of PostHog analytics in your account settings.</li>
        <li>
          Delete your account and all associated data at any time. You can do
          this in your account settings or by contacting{" "}
          <Link href="mailto:legal@lets-assist.com">legal@lets-assist.com</Link>
          .
        </li>
      </ul>

      <h2>8. Data retention</h2>
      <p>
        We keep your personal data as long as your account is active. If you
        delete your account, we will remove your data within a reasonable
        timeframe, except where we are legally required to retain it.
      </p>

      <h2>9. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy to reflect changes in our practices or
        legal requirements. Significant changes will be communicated via email
        or website notifications. We recommend reviewing this policy
        periodically.
      </p>

      <h2>10. Contact us</h2>
      <p>
        For privacy-related inquiries, email us at{" "}
        <Link href="mailto:legal@lets-assist.com">legal@lets-assist.com</Link>.
      </p>
    </LongFormPage>
  );
};

export default PrivacyPage;
