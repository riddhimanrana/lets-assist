import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { isUnder13 } from '@/utils/age-helpers';
import { ShieldAlert, Lock, Mail, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default async function RestrictedPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get profile to check restriction status
  const { data: profile } = await supabase
    .from('profiles')
    .select('date_of_birth, parental_consent_required, parental_consent_verified, full_name')
    .eq('id', user.id)
    .single();

  // If no restrictions, redirect to dashboard
  if (
    !profile?.parental_consent_required ||
    profile.parental_consent_verified ||
    !profile.date_of_birth ||
    !isUnder13(profile.date_of_birth)
  ) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="relative">
              <ShieldAlert className="h-24 w-24 text-amber-500 dark:text-amber-400" />
              <Lock className="h-10 w-10 text-amber-600 dark:text-amber-300 absolute bottom-0 right-0 bg-background rounded-full p-1 border-2 border-background" />
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Account Restricted</h1>
          <p className="text-xl text-muted-foreground">
            Parental consent is required to access this platform
          </p>
        </div>

        <div className="p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 space-y-4">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">
                Why is my account restricted?
              </h2>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                Under the Children's Online Privacy Protection Act (COPPA), we need permission from your
                parent or legal guardian before you can use Let's Assist.
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                This law protects children under 13 years old by requiring parental consent for online services
                that collect personal information.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 bg-card rounded-lg border space-y-6">
          <h2 className="text-xl font-semibold">What you need to do:</h2>

          <div className="space-y-4">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1">Request Parental Consent</h3>
                <p className="text-sm text-muted-foreground">
                  Click the button below to send a consent request to your parent or guardian's email address.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                2
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1">Parent Reviews & Approves</h3>
                <p className="text-sm text-muted-foreground">
                  Your parent/guardian will receive an email with information about Let's Assist and a link to
                  provide consent.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                3
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1">Access Granted</h3>
                <p className="text-sm text-muted-foreground">
                  Once your parent approves, you'll have full access to explore volunteer opportunities and
                  start making a difference in your community!
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start space-x-3">
            <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                Ready to get started?
              </h3>
              <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
                Send a consent request to your parent or guardian now. The process only takes a few minutes!
              </p>
              <Link href="/account/parental-consent">
                <Button size="lg" className="w-full sm:w-auto">
                  Send Consent Request
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Have questions? We're here to help!
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link href="/help" className="text-sm text-primary hover:underline">
              Visit Help Center
            </Link>
            <Link href="/contact" className="text-sm text-primary hover:underline">
              Contact Support
            </Link>
            <Link href="/logout" className="text-sm text-muted-foreground hover:underline">
              Sign Out
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
