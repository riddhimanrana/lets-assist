import { redirect } from 'next/navigation';
import { verifyConsentToken } from '@/app/account/parental-consent/actions';
import ParentalConsentApprovalForm from './ParentalConsentApprovalForm';

interface ParentalConsentPageProps {
  params: {
    token: string;
  };
}

export default async function ParentalConsentPage({ params }: ParentalConsentPageProps) {
  const { token } = params;

  // Verify the token
  const verification = await verifyConsentToken(token);

  if (verification.error || !verification.consent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <div className="text-6xl mb-4">❌</div>
            <h1 className="text-3xl font-bold tracking-tight text-destructive">Invalid Consent Link</h1>
            <p className="text-muted-foreground">
              {verification.error || 'This consent link is not valid.'}
            </p>
          </div>

          <div className="p-6 bg-muted/50 rounded-lg border">
            <p className="text-sm text-muted-foreground">
              <strong>Common reasons for invalid links:</strong>
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
              <li>The link has expired (links are valid for 7 days)</li>
              <li>Consent has already been provided</li>
              <li>The link was copied incorrectly</li>
              <li>A newer consent request has been sent</li>
            </ul>
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Need help? Contact us at{' '}
              <a
                href="mailto:support@letsassist.org"
                className="text-primary hover:underline"
              >
                support@letsassist.org
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { consent } = verification;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-3xl w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="text-6xl mb-4">🛡️</div>
          <h1 className="text-3xl font-bold tracking-tight">Parental Consent Request</h1>
          <p className="text-muted-foreground">
            Please review the information below and provide your consent
          </p>
        </div>

        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Student Information</p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                <strong>Name:</strong> {consent.studentName}
                <br />
                <strong>Email:</strong> {consent.studentEmail}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Parent/Guardian Information</p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                <strong>Name:</strong> {consent.parentName}
                <br />
                <strong>Email:</strong> {consent.parentEmail}
              </p>
            </div>
            <div>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                <strong>Request Date:</strong> {new Date(consent.createdAt).toLocaleDateString()} at{' '}
                {new Date(consent.createdAt).toLocaleTimeString()}
                <br />
                <strong>Expires:</strong> {new Date(consent.expiresAt).toLocaleDateString()} at{' '}
                {new Date(consent.expiresAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-6 bg-card rounded-lg border space-y-4">
            <h2 className="text-xl font-semibold">Why is consent required?</h2>
            <p className="text-sm text-muted-foreground">
              The Children's Online Privacy Protection Act (COPPA) requires that we obtain verifiable parental consent
              before collecting, using, or disclosing personal information from children under 13 years of age.
            </p>
          </div>

          <div className="p-6 bg-card rounded-lg border space-y-4">
            <h2 className="text-xl font-semibold">What you're consenting to:</h2>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
              <li>Your child creating and maintaining an account on Let's Assist</li>
              <li>Collection of basic profile information (name, email, date of birth)</li>
              <li>Your child browsing and applying for volunteer opportunities</li>
              <li>Your child creating and managing volunteer projects (with moderation)</li>
              <li>Automated AI content moderation of all user-generated content</li>
            </ul>
          </div>

          <div className="p-6 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <h2 className="text-xl font-semibold text-green-900 dark:text-green-100 mb-3">Safety Features</h2>
            <ul className="text-sm text-green-700 dark:text-green-300 space-y-2 list-disc list-inside">
              <li>
                <strong>Private Profile by Default:</strong> Your child's profile is set to private and cannot be made
                public until they turn 13
              </li>
              <li>
                <strong>AI Content Moderation:</strong> All user-generated content is automatically scanned for
                inappropriate material
              </li>
              <li>
                <strong>No Direct Messaging:</strong> The platform does not allow direct messaging between users
              </li>
              <li>
                <strong>Supervised Events:</strong> All volunteer events require adult supervision
              </li>
              <li>
                <strong>Reporting System:</strong> Easy-to-use reporting tools for inappropriate content or behavior
              </li>
              <li>
                <strong>CIPA Compliance:</strong> Full compliance with the Children's Internet Protection Act for
                educational institutions
              </li>
            </ul>
          </div>

          <div className="p-6 bg-card rounded-lg border space-y-4">
            <h2 className="text-xl font-semibold">Your Rights</h2>
            <p className="text-sm text-muted-foreground">As a parent or guardian, you have the right to:</p>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
              <li>Review the personal information collected from your child</li>
              <li>Request deletion of your child's personal information</li>
              <li>Refuse to allow further collection or use of your child's information</li>
              <li>Revoke consent at any time by contacting us</li>
            </ul>
          </div>

          <div className="flex gap-4">
            <a
              href={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center py-3 px-4 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors text-sm font-medium"
            >
              Read Privacy Policy
            </a>
            <a
              href={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center py-3 px-4 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors text-sm font-medium"
            >
              Read Terms of Service
            </a>
          </div>
        </div>

        <ParentalConsentApprovalForm token={token} consent={consent} />

        <div className="text-xs text-center text-muted-foreground">
          <p>Questions or concerns? Contact us at support@letsassist.org</p>
        </div>
      </div>
    </div>
  );
}
