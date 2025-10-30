import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { isUnder13 } from '@/utils/age-helpers';
import ParentalConsentRequestForm from './ParentalConsentRequestForm';
import { Shield } from 'lucide-react';

export default async function ParentalConsentPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get profile to check age and consent status
  const { data: profile } = await supabase
    .from('profiles')
    .select('date_of_birth, parental_consent_required, parental_consent_verified, full_name, email')
    .eq('id', user.id)
    .single();

  // If no DOB, redirect to onboarding
  if (!profile?.date_of_birth) {
    redirect('/auth/dob-onboarding');
  }

  // Check if user is under 13
  const requiresConsent = isUnder13(profile.date_of_birth);

  // If user doesn't require consent, redirect to dashboard
  if (!requiresConsent || !profile.parental_consent_required) {
    redirect('/dashboard');
  }

  // If consent already verified, redirect to dashboard
  if (profile.parental_consent_verified) {
    redirect('/dashboard');
  }

  // Check if there's already a pending consent request
  const { data: existingConsent } = await supabase
    .from('parental_consents')
    .select('*')
    .eq('student_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Parental Consent Required</h1>
          <p className="text-muted-foreground">
            To comply with COPPA regulations, we need consent from your parent or legal guardian before you can fully access the platform.
          </p>
        </div>

        <div className="p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex items-start space-x-3">
            <Shield className="text-2xl text-amber-600" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                Why is this required?
              </p>
              <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
                <li>The Children's Online Privacy Protection Act (COPPA) requires parental consent for users under 13</li>
                <li>This ensures your safety and privacy online</li>
                <li>Your parent or guardian will receive an email to approve your account</li>
              </ul>
            </div>
          </div>
        </div>

        {existingConsent ? (
          <div className="space-y-4">
            <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-start space-x-3">
                <div className="text-2xl">📧</div>
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    Consent Request Sent
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    We've sent a consent request to <strong>{existingConsent.parent_email}</strong>.
                    Please ask your parent or guardian to check their email and click the approval link.
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                    Sent on: {new Date(existingConsent.created_at).toLocaleDateString()} at {new Date(existingConsent.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Need to send the request to a different email?
              </p>
              <ParentalConsentRequestForm
                studentId={user.id}
                studentName={profile.full_name || 'Student'}
                studentEmail={profile.email || user.email || ''}
                isResend={true}
              />
            </div>
          </div>
        ) : (
          <ParentalConsentRequestForm
            studentId={user.id}
            studentName={profile.full_name || 'Student'}
            studentEmail={profile.email || user.email || ''}
          />
        )}

        <div className="text-xs text-center text-muted-foreground space-y-1">
          <p>⚠️ You must complete this step to access your account.</p>
          <p>The consent link will expire in 7 days.</p>
        </div>
      </div>
    </div>
  );
}
