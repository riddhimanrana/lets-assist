import React from "react";
import Link from "next/link";
import { LongFormPage } from "@/components/projects/LongFormPage";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Read the terms of service for Let's Assist to understand your rights and obligations.",
};

const TermsPage = () => {
  return (
    <LongFormPage
      title="Terms of Service"
      meta="Last updated December 31, 2025"
    >
      <h2>1. Introduction</h2>
      <p>
        Welcome to Let&apos;s Assist (&quot;we,&quot; &quot;our,&quot; or
        &quot;us&quot;). By accessing or using our website (lets-assist.com) and
        services, you agree to comply with these Terms of Service
        (&quot;Terms&quot;). If you do not agree, please do not use our
        services. These Terms govern your use of our platform, including how you
        interact with volunteering opportunities and other users.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 13 years old to use Let&apos;s Assist. By using our
        services, you confirm that you are at least 13 years old and have the
        legal capacity to agree to these Terms.
      </p>

      <h2>3. User responsibilities</h2>
      <p>By using Let&apos;s Assist, you agree to:</p>
      <ul>
        <li>Use the platform for lawful purposes only.</li>
        <li>
          Provide accurate and truthful information when creating an account or
          submitting volunteer applications.
        </li>
        <li>
          Refrain from engaging in any fraudulent, misleading, or harmful
          behavior on the platform.
        </li>
        <li>
          Respect other users and avoid any form of harassment, discrimination,
          or misconduct.
        </li>
        <li>
          Keep your login credentials secure and not share them with others.
        </li>
        <li>
          Not post spam, inappropriate, or misleading volunteer opportunities.
        </li>
        <li>
          Avoid submitting duplicate, irrelevant, or deceptive listings to the
          platform.
        </li>
        <li>
          Abide by all applicable laws and regulations when using the platform.
        </li>
      </ul>

      <h2>4. Volunteer opportunities</h2>
      <p>
        Let&apos;s Assist connects volunteers with organizations. We do not
        verify, guarantee, or endorse any volunteer opportunities. You are
        solely responsible for evaluating opportunities, conducting your own
        research, and deciding whether to participate. We are not liable for any
        issues, injuries, or disputes arising from your participation in
        volunteering activities.
      </p>
      <p>Organizations posting opportunities agree to:</p>
      <ul>
        <li>Provide accurate descriptions of volunteer needs.</li>
        <li>Treat volunteers respectfully and safely.</li>
        <li>Not post fraudulent, misleading, or inappropriate content.</li>
      </ul>
      <p>
        We reserve the right to remove content and suspend or terminate accounts
        that violate these guidelines.
      </p>

      <h2>5. Data and Privacy</h2>
      <p>
        By using Let&apos;s Assist, you agree to our Privacy Policy. See that
        document for details on what data we collect, how we use it, and your
        rights. You can delete your account and all associated data at any time.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        Let&apos;s Assist is provided &quot;as is&quot; without warranties. To
        the fullest extent permitted by law, we are not liable for any damages,
        losses, or disputes arising from your use of the platform or
        interactions with organizations and other users.
      </p>

      <h2>7. Account suspension</h2>
      <p>
        We reserve the right to suspend or terminate your account if you violate
        these Terms, including but not limited to: providing false information,
        engaging in harassment or misconduct, or misusing the platform.
      </p>

      <h2>8. Changes to Terms</h2>
      <p>
        We may update these Terms at any time. Continued use of Let&apos;s
        Assist after changes means you accept the updated Terms. We encourage
        users to review this page periodically for any modifications.
      </p>

      <h2>9. Contact</h2>
      <p>
        For any questions, reach out to us at{" "}
        <Link href="mailto:support@lets-assist.com">
          support@lets-assist.com
        </Link>
      </p>
    </LongFormPage>
  );
};

export default TermsPage;
