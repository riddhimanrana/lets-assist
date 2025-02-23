import React from 'react';
import Link from 'next/link';

const TermsPage = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-8">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm mt-0 mb-8 text-muted-foreground">Last updated February 22, 2025</p>

        <section className="mt-8 text-left max-w-2xl space-y-8">
          <h2 className="text-2xl font-semibold">1. Introduction</h2>
          <p className="mt-2 leading-relaxed">
            Welcome to Let&apos;s Assist (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). By accessing or using our website (lets-assist.com) and services, you agree to comply with these Terms of Service (&quot;Terms&quot;). If you do not agree, please do not use our services. These Terms govern your use of our platform, including how you interact with volunteering opportunities and other users.
          </p>

          <h2 className="text-2xl font-semibold">2. Eligibility</h2>
          <p className="mt-2 leading-relaxed">
            You must be at least 13 years old to use Let&apos;s Assist. By using our services, you confirm that you meet this requirement and have the legal capacity to agree to these Terms. If you are under 18, you must have parental or guardian consent before using our services.
          </p>

          <h2 className="text-2xl font-semibold">3. User Responsibilities</h2>
          <p className="mt-2 leading-relaxed">
            By using Let&apos;s Assist, you agree to:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Use the platform for lawful purposes only.</li>
            <li>Provide accurate and truthful information when creating an account or submitting volunteer applications.</li>
            <li>Refrain from engaging in any fraudulent, misleading, or harmful behavior on the platform.</li>
            <li>Respect other users and avoid any form of harassment, discrimination, or misconduct.</li>
            <li>Keep your login credentials secure and not share them with others.</li>
            <li>Not post spam, inappropriate, or misleading volunteer opportunities.</li>
            <li>Avoid submitting duplicate, irrelevant, or deceptive listings to the platform.</li>
            <li>Abide by all applicable laws and regulations when using the platform.</li>
          </ul>

          <h2 className="text-2xl font-semibold">4. Volunteer Opportunities</h2>
          <p className="mt-2 leading-relaxed">
            Let&apos;s Assist serves as a bridge between volunteers and organizations in need of assistance. While we strive to ensure the quality of listings, we do not verify or guarantee the safety, accuracy, or legitimacy of any volunteer opportunities. Users are responsible for conducting their own research and exercising caution before participating in any activity.
          </p>
          <p className="mt-2 leading-relaxed">
            Organizations listing opportunities on Let&apos;s Assist must:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Provide clear and accurate descriptions of their volunteer needs.</li>
            <li>Not misrepresent the nature of the opportunity or the expected responsibilities.</li>
            <li>Ensure a safe and welcoming environment for volunteers.</li>
            <li>Not post misleading, inappropriate, or fraudulent content.</li>
            <li>Avoid excessive or duplicate postings to maintain platform integrity.</li>
          </ul>
          <p className="mt-2 leading-relaxed">
            Failure to adhere to these guidelines may result in removal of content and suspension or termination of account access.
          </p>

          <h2 className="text-2xl font-semibold">5. Data and Privacy</h2>
          <p className="mt-2 leading-relaxed">
            By using Let&apos;s Assist, you agree to our Privacy Policy. We collect and process data as described in that policy to enhance user experience and improve our platform. You acknowledge that:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>We may use analytics tools like PostHog to gather insights on platform usage.</li>
            <li>Supabase is used for secure data management and storage.</li>
            <li>Your personal information is protected under our security protocols, but no system is completely immune to potential breaches.</li>
            <li>You have the right to delete your account and all associated data at any time (see Privacy Policy for details).</li>
          </ul>

          <h2 className="text-2xl font-semibold">6. Limitation of Liability</h2>
          <p className="mt-2 leading-relaxed">
            Let&apos;s Assist is provided &quot;as is&quot; without warranties of any kind. We make no guarantees about the accuracy, reliability, or availability of our platform and are not liable for:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-2">
            <li>Any losses or damages resulting from the use or inability to use our services.</li>
            <li>Issues arising from interactions with third-party organizations or volunteers.</li>
            <li>Unauthorized access to user data due to unforeseen security vulnerabilities.</li>
          </ul>

          <h2 className="text-2xl font-semibold">7. Changes to Terms</h2>
          <p className="mt-2 leading-relaxed">
            We may update these Terms at any time. Continued use of Let&apos;s Assist after changes means you accept the updated Terms. We encourage users to review this page periodically for any modifications.
          </p>

          <h2 className="text-2xl font-semibold">8. Contact</h2>
          <p className="mt-2 leading-relaxed">
            For any questions, reach out to us at  <Link href="mailto:support@lets-assist.com" className="text-chart-3">support@lets-assist.com</Link>
          </p>
        </section>
      </main>
    </div>
  );
};

export default TermsPage;
