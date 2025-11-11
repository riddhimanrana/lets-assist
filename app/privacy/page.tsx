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
          Last updated October 12, 2025
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
            We collect different types of data to provide and improve our
            services:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>
              <strong>Personal Information:</strong> When you sign up or contact
              us, we collect your name, email address, and any other details you
              provide.
            </li>
            <li>
              <strong>Usage Data:</strong> We collect data about your
              interactions with the platform, including browsing behavior,
              search queries, and participation in volunteering opportunities.
              This helps us analyze trends and improve our services.
            </li>
            <li>
              <strong>Cookies and Tracking Technologies:</strong> We use cookies
              and similar tracking technologies to personalize your experience
              and monitor website performance.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold">3. How We Use Your Data</h2>
          <p className="mt-2 leading-relaxed">We use the collected data to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>
              Facilitate and enhance the user experience on Let&apos;s Assist.
            </li>
            <li>
              Provide relevant volunteering opportunities and recommendations.
            </li>
            <li>Improve our platform through analytics and user feedback.</li>
            <li>
              Communicate updates, notifications, and important service
              announcements.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold">4. Google Calendar Integration</h2>
          <p className="mt-2 leading-relaxed">
            If you choose to connect your Google Calendar to Let&apos;s Assist, we access and use your Google user data as follows:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>
              <strong>Data We Access:</strong> We access your Google Calendar to create and manage events for volunteering opportunities you sign up for. We also access your email address to verify your Google account connection.
            </li>
            <li>
              <strong>How We Use It:</strong> We use your Google Calendar access to automatically add volunteering events to a dedicated &quot;Let&apos;s Assist Volunteering&quot; calendar or your primary calendar. This helps you keep track of your volunteering commitments. We store encrypted access tokens to maintain this connection.
            </li>
            <li>
              <strong>Data Sharing:</strong> We do not share, transfer, or disclose your Google Calendar data or email address to any third parties. Your Google user data is used solely within Let&apos;s Assist to provide calendar synchronization features and is never sold, rented, or shared with external organizations or advertisers.
            </li>
            <li>
              <strong>Data Storage:</strong> Your Google Calendar access tokens are encrypted and stored securely in our database. We do not store the contents of your calendar events beyond the volunteering events we create on your behalf.
            </li>
            <li>
              <strong>Revoking Access:</strong> You can disconnect your Google Calendar at any time from your account settings. This will revoke our access to your Google Calendar and delete all stored tokens. Events already created in your calendar will remain unless you delete them manually.
            </li>
          </ul>
          <p className="mt-2 leading-relaxed">
            Let&apos;s Assist&apos;s use and transfer of information received from Google APIs adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-chart-3 underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>

          <h2 className="text-2xl font-semibold">5. Third-Party Services</h2>
          <p className="mt-2 leading-relaxed">
            We collaborate with third-party services to optimize our platform:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>
              <strong>Supabase:</strong> For secure data storage and management.
            </li>
            <li>
              <strong>PostHog:</strong> To analyze usage data and enhance user
              experience.
            </li>
          </ul>
          <p className="mt-2 leading-relaxed">
            These services have their own privacy policies, and by using
            Let&apos;s Assist, you also agree to their data processing
            practices. We do not share your Google user data with these third-party services.
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
            <li>Access the personal data we hold about you.</li>
            <li>
              Request corrections or deletions of inaccurate or outdated
              information.
            </li>
            <li>Withdraw consent for data processing where applicable.</li>
            <li>
              Opt out of analytics tracking by adjusting your browser settings
              or using available opt-out tools.
            </li>
            <li>
              Delete your account and all associated personal data at any time.
              If you wish to delete your account, you can do so in your account
              settings or by contacting{" "}
              <Link
                href="mailto:privacy@lets-assist.com"
                className="text-chart-3"
              >
                privacy@lets-assist.com
              </Link>
              .
            </li>
          </ul>

          <h2 className="text-2xl font-semibold">8. Retention of Data</h2>
          <p className="mt-2 leading-relaxed">
            We retain personal data only for as long as necessary to fulfill the
            purposes outlined in this Privacy Policy. When data is no longer
            needed, we securely delete or anonymize it. If you request account
            deletion, we will remove your personal information from our system
            within a reasonable timeframe, subject to any legal obligations.
          </p>

          <h2 className="text-2xl font-semibold">9. Changes to this Policy</h2>
          <p className="mt-2 leading-relaxed">
            We may update this Privacy Policy to reflect changes in our
            practices or legal requirements. Significant changes will be
            communicated via email or website notifications. We recommend
            reviewing this policy periodically.
          </p>

          <h2 className="text-2xl font-semibold">10. Contact</h2>
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
