import { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResendVerificationButton } from "./ResendVerificationButton";

export const metadata: Metadata = {
  title: "Signup Success",
  description: "Your account has been created successfully.",
};

type SignupSuccessSearchParams = {
  email?: string;
};

type PageProps = {
  searchParams: Promise<SignupSuccessSearchParams>;
};

export default async function SignupSuccessPage({
  searchParams,
}: PageProps) {
  const resolvedSearchParams = await searchParams;
  const email = resolvedSearchParams.email;

  if (!email) {
    // If no email is provided, redirect to signup
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader className="text-center">
            <CardTitle>Invalid Access</CardTitle>
            <CardDescription>
              Please sign up to create an account.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex justify-center">
            <Link href="/signup">
              <Button>Go to Signup</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-3">
              <CheckCircle2 className="h-12 w-12 text-primary" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl">Account Created Successfully!</CardTitle>
            <CardDescription className="mt-2">
              We&apos;ve sent a verification email to:
            </CardDescription>
            <p className="text-sm font-semibold mt-1 text-foreground">{email}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Next Steps:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Check your email inbox (and spam/junk folder)</li>
                  <li>Click the verification link in the email</li>
                  <li>Complete your profile setup</li>
                  <li>Start exploring volunteering opportunities!</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="text-center text-sm text-muted-foreground">
            <p>Didn&apos;t receive the email?</p>
          </div>

          <ResendVerificationButton email={email} />
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <div className="text-xs text-center text-muted-foreground">
            Already verified your email?{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Log in here
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
