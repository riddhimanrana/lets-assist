import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Email successfully confirmed</CardTitle>
          <CardDescription>
            Your spot is locked in and we've notified the organizers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Thanks for taking the next step to support your community!
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild variant="secondary" className="w-full sm:w-auto">
            <Link href={`/anonymous/${anonymousSignupId}`}>
              View signup details
            </Link>
          </Button>
          <Button asChild className="w-full sm:w-auto">
            <Link href="/projects" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              Find another project
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
