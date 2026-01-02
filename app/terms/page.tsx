import React from "react";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Read the terms of service for Let's Assist to understand your rights and obligations.",
};

const TermsPage = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-8 px-6">
      <main className="flex flex-col items-center justify-center w-full flex-1 sm:px-10 md:px-24 text-center">
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm mt-0 mb-8 text-muted-foreground">
          Last updated December 31, 2025
        </p>

        <section className="mt-8 text-left max-w-2xl space-y-8">
          <h2 className="text-2xl font-semibold">1. Introduction</h2>
          <p className="mt-2 leading-relaxed">
            Welcome to Let&apos;s Assist (&quot;we,&quot; &quot;our,&quot; or
            &quot;us&quot;). By accessing or using our website (lets-assist.com)
            and services, you agree to comply with these Terms of Service
            (&quot;Terms&quot;). If you do not agree, please do not use our
            services. These Terms govern your use of our platform, including how
            you interact with volunteering opportunities and other users.
          </p>

          <h2 className="text-2xl font-semibold">2. Eligibility</h2>
          <p className="mt-2 leading-relaxed">
            You must be at least 13 years old to use Let&apos;s Assist. By using
            our services, you confirm that you are at least 13 years old and have
            the legal capacity to agree to these Terms.
          </p>

          <h2 className="text-2xl font-semibold">3. User Responsibilities</h2>
          <p className="mt-2 leading-relaxed">
            By using Let&apos;s Assist, you agree to:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Use the platform for lawful purposes only.</li>
            <li>
              Provide accurate and truthful information when creating an account
              or submitting volunteer applications.
            </li>
            <li>
              Refrain from engaging in any fraudulent, misleading, or harmful
              behavior on the platform.
            </li>
            <li>
              Respect other users and avoid any form of harassment,
              discrimination, or misconduct.
            </li>
            <li>
              Keep your login credentials secure and not share them with others.
            </li>
            <li>
              Not post spam, inappropriate, or misleading volunteer
              opportunities.
            </li>
            <li>
              Avoid submitting duplicate, irrelevant, or deceptive listings to
              the platform.
            </li>
            <li>
              Abide by all applicable laws and regulations when using the
              platform.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold">4. Volunteer Opportunities</h2>
          <p className="mt-2 leading-relaxed">
            Let&apos;s Assist connects volunteers with organizations. We do not
            verify, guarantee, or endorse any volunteer opportunities. You are
            solely responsible for evaluating opportunities, conducting your own
            research, and deciding whether to participate. We are not liable for
            any issues, injuries, or disputes arising from your participation in
            volunteering activities.
          </p>
          <p className="mt-2 leading-relaxed">
            Organizations posting opportunities agree to:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Provide accurate descriptions of volunteer needs.</li>
            <li>Treat volunteers respectfully and safely.</li>
            <li>Not post fraudulent, misleading, or inappropriate content.</li>
          </ul>
          <p className="mt-2 leading-relaxed">
            We reserve the right to remove content and suspend or terminate
            accounts that violate these guidelines.
          </p>

          <h2 className="text-2xl font-semibold">5. Data and Privacy</h2>
          <p className="mt-2 leading-relaxed">
            By using Let&apos;s Assist, you agree to our Privacy Policy. See that
            document for details on what data we collect, how we use it, and your
            rights. You can delete your account and all associated data at any time.
          </p>

          <h2 className="text-2xl font-semibold">6. Limitation of Liability</h2>
          <p className="mt-2 leading-relaxed">
            Let&apos;s Assist is provided &quot;as is&quot; without warranties.
            To the fullest extent permitted by law, we are not liable for any
            damages, losses, or disputes arising from your use of the platform or
            interactions with organizations and other users.
          </p>

          <h2 className="text-2xl font-semibold">7. Account Suspension</h2>
          <p className="mt-2 leading-relaxed">
            We reserve the right to suspend or terminate your account if you
            violate these Terms, including but not limited to: providing false
            information, engaging in harassment or misconduct, or misusing the
            platform.
          </p>

          <h2 className="text-2xl font-semibold">8. Changes to Terms</h2>
          <p className="mt-2 leading-relaxed">
            We may update these Terms at any time. Continued use of Let&apos;s
            Assist after changes means you accept the updated Terms. We
            encourage users to review this page periodically for any
            modifications.
          </p>

          <h2 className="text-2xl font-semibold">9. Contact</h2>
          <p className="mt-2 leading-relaxed">
            For any questions, reach out to us at{" "}
            <Link
              href="mailto:support@lets-assist.com"
              className="text-chart-3"
            >
              support@lets-assist.com
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
};

export default TermsPage;
