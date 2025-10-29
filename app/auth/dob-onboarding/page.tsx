import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { isInstitutionEmail } from "@/utils/settings/profile-settings";
import DOBOnboardingForm from "./DOBOnboardingForm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LogOut, Lock } from "lucide-react";

export default async function DOBOnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get profile to check if DOB is already set
  const { data: profile } = await supabase
    .from("profiles")
    .select("date_of_birth, email")
    .eq("id", user.id)
    .single();

  // If DOB already exists, redirect to dashboard
  if (profile?.date_of_birth) {
    redirect("/dashboard");
  }

  // Check if this is an institution email
  const email = profile?.email || user.email || "";
  const isInstitution = await isInstitutionEmail(email);

  // If not institution email, they don't need DOB onboarding
  if (!isInstitution) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with logout */}
      {/*<div className="border-b bg-card">
        <div className="container max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold text-sm">
              Account Setup Required
            </span>
          </div>
          <Link href="/logout">
            <Button variant="ghost" size="sm">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </Link>
        </div>
      </div>*/}

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4 bg-background">
        <div className="max-w-md w-full space-y-6">
          {/*<div className="p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Profile Completion Required
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  You must complete this step before accessing other features of
                  Let's Assist.
                </p>
              </div>
            </div>
          </div>*/}

          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Complete Your Profile
            </h1>
            <p className="text-muted-foreground">
              As a student account, we need your date of birth to provide
              age-appropriate content and comply with educational safety
              regulations.
            </p>
          </div>

          <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Student Account Detected
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              Your email ({email}) is from an educational institution. This
              information helps us keep you safe online.
            </p>
          </div>

          <DOBOnboardingForm userId={user.id} />

          <p className="text-xs text-center text-muted-foreground">
            Your information is stored securely and used only for age
            verification and compliance purposes.
          </p>
        </div>
      </div>
    </div>
  );
}
