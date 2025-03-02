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
          Last updated February 22, 2025
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

          <h2 className="text-2xl font-semibold">4. Third-Party Services</h2>
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
            practices.
          </p>

          <h2 className="text-2xl font-semibold">5. Data Security</h2>
          <p className="mt-2 leading-relaxed">
            We implement strict security measures to protect your personal data
            from unauthorized access, loss, or misuse. However, no system is
            completely secure, and we cannot guarantee absolute protection. We
            encourage users to take precautions, such as using strong passwords
            and being mindful of data sharing.
          </p>

          <h2 className="text-2xl font-semibold">6. Your Rights</h2>
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

          <h2 className="text-2xl font-semibold">7. Retention of Data</h2>
          <p className="mt-2 leading-relaxed">
            We retain personal data only for as long as necessary to fulfill the
            purposes outlined in this Privacy Policy. When data is no longer
            needed, we securely delete or anonymize it. If you request account
            deletion, we will remove your personal information from our system
            within a reasonable timeframe, subject to any legal obligations.
          </p>

          <h2 className="text-2xl font-semibold">8. Changes to this Policy</h2>
          <p className="mt-2 leading-relaxed">
            We may update this Privacy Policy to reflect changes in our
            practices or legal requirements. Significant changes will be
            communicated via email or website notifications. We recommend
            reviewing this policy periodically.
          </p>

          <h2 className="text-2xl font-semibold">9. Contact</h2>
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
