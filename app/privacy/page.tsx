import React from "react";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read the privacy policy for Let's Assist to understand how we handle your data and protect your privacy.",
};

const PrivacyPage = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-8 px-6">
      <main className="flex flex-col items-center justify-center w-full flex-1 sm:px-10 md:px-24 text-center">
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm mt-0 mb-8 text-muted-foreground">
          Last updated December 31, 2025
        </p>

        <section className="mt-8 text-left max-w-2xl space-y-8">
          <h2 className="text-2xl font-semibold">1. Introduction</h2>
          <p className="mt-2 leading-relaxed">
            At Let&apos;s Assist, we value your privacy. This Privacy Policy
            explains what information we collect, how we use it, and your rights
            regarding your data. We are committed to protecting your personal
            information and being transparent about our data practices.
          </p>

          <h2 className="text-2xl font-semibold">2. Information We Collect</h2>
          <p className="mt-2 leading-relaxed">
            We collect the following information:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>
              <strong>Personal Information:</strong> Email address, name, and
              phone number (if you choose to provide it) when you create an
              account or sign up for events.
            </li>
            <li>
              <strong>Event Data:</strong> Your participation in volunteering
              opportunities, including sign-ups, check-in/check-out times, and
              event attendance.
            </li>
            <li>
              <strong>Analytics Data:</strong> We use PostHog to collect
              anonymized data about how you interact with our platform (page
              views, clicks, etc.) to improve our services. You can opt out of
              analytics in your account settings.
            </li>
            <li>
              <strong>Google Calendar Data (Optional):</strong> If you choose to
              connect your Google Calendar, we access and store encrypted tokens
              to add volunteering events to your calendar. We do not store your
              calendar contents.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold">3. How We Use Your Data</h2>
          <p className="mt-2 leading-relaxed">We use the collected data to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Create and manage your account.</li>
            <li>Process your signups for volunteering opportunities.</li>
            <li>
              Manage event check-ins/check-outs and send certificates when
              applicable.
            </li>
            <li>
              Add events to your Google Calendar if you&apos;ve connected it.
            </li>
            <li>
              Improve our platform through anonymized analytics (PostHog).
            </li>
            <li>Send you important service notifications and updates.</li>
          </ul>

          <h2 className="text-2xl font-semibold">4. Google Calendar Integration (Optional)</h2>
          <p className="mt-2 leading-relaxed">
            If you choose to connect your Google Calendar:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>
              <strong>What We Access:</strong> We access your Google Calendar
              and email address to verify your account and add volunteering
              events.
            </li>
            <li>
              <strong>How We Use It:</strong> We automatically add volunteering
              events to your calendar. We store encrypted access tokens locally
              to maintain this connection.
            </li>
            <li>
              <strong>No Sharing:</strong> We do not share your Google Calendar
              data with third parties. It is used only within Let&apos;s Assist.
            </li>
            <li>
              <strong>How to Disconnect:</strong> You can revoke access at any
              time in your account settings. This deletes our stored tokens.
              Events already in your calendar will remain unless you delete them
              manually.
            </li>
          </ul>
          <p className="mt-2 leading-relaxed">
            Our use of Google APIs complies with the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-chart-3 underline"
            >
              Google API Services User Data Policy
            </a>
            .
          </p>

          <h2 className="text-2xl font-semibold">5. Third-Party Services</h2>
          <p className="mt-2 leading-relaxed">
            We use the following services:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>
              <strong>Supabase:</strong> Secure database hosting and management.
            </li>
            <li>
              <strong>PostHog:</strong> Optional analytics to improve our
              platform. You can opt out in your settings.
            </li>
          </ul>
          <p className="mt-2 leading-relaxed">
            These services have their own privacy policies. We do not share your
            personal data with these services beyond what is necessary for them
            to operate (e.g., Supabase stores your data, PostHog only receives
            anonymized usage information).
          </p>

          <h2 className="text-2xl font-semibold">6. Data Security</h2>
          <p className="mt-2 leading-relaxed">
            We implement strict security measures to protect your personal data
            from unauthorized access, loss, or misuse. However, no system is
            completely secure, and we cannot guarantee absolute protection. We
            encourage users to take precautions, such as using strong passwords
            and being mindful of data sharing.
          </p>

          <h2 className="text-2xl font-semibold">7. Your Rights</h2>
          <p className="mt-2 leading-relaxed">You have the right to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Access the personal data we have about you.</li>
            <li>Request corrections or deletions of inaccurate information.</li>
            <li>Opt out of PostHog analytics in your account settings.</li>
            <li>
              Delete your account and all associated data at any time. You can do
              this in your account settings or by contacting{" "}
              <Link
                href="mailto:privacy@lets-assist.com"
                className="text-chart-3"
              >
                privacy@lets-assist.com
              </Link>
              .
            </li>
          </ul>

          <h2 className="text-2xl font-semibold">8. Data Retention</h2>
          <p className="mt-2 leading-relaxed">
            We keep your personal data as long as your account is active. If you
            delete your account, we will remove your data within a reasonable
            timeframe, except where we are legally required to retain it.
          </p>

          <h2 className="text-2xl font-semibold">9. Changes to this Policy</h2>
          <p className="mt-2 leading-relaxed">
            We may update this Privacy Policy to reflect changes in our
            practices or legal requirements. Significant changes will be
            communicated via email or website notifications. We recommend
            reviewing this policy periodically.
          </p>

          <h2 className="text-2xl font-semibold">10. Contact Us</h2>
          <p className="mt-2 leading-relaxed">
            For privacy-related inquiries, email us at{" "}
            <Link
              href="mailto:privacy@lets-assist.com"
              className="text-chart-3"
            >
              privacy@lets-assist.com
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
};

export default PrivacyPage;
