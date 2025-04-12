import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Home } from "lucide-react";
import Link from "next/link";

interface SuccessMessageProps {
  anonymousSignupId: string;
}

export function SuccessMessage({ anonymousSignupId }: SuccessMessageProps) {
  return (
    <div className="container mx-auto flex min-h-[calc(100vh-150px)] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-chart-5/10">
            <CheckCircle2 className="h-10 w-10 text-chart-5" />
          </div>
          <CardTitle className="text-2xl font-bold">Signup Confirmed!</CardTitle>
          <CardDescription>
            Your spot for the volunteer project has been successfully confirmed. Thank you for making a difference!
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
           <Button asChild variant="secondary">
            <Link href={`/anonymous/${anonymousSignupId}`}>
              View Your Signup Details
            </Link>
          </Button>
          <Button asChild>
            <Link href="/projects" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              Browse Other Projects
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
