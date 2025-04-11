import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Home } from "lucide-react";
import Link from "next/link";

interface ErrorMessageProps {
  message?: string; // Optional specific error message
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  const defaultMessage = "We couldn't confirm your signup. The confirmation link might be invalid, expired, or already used.";

  return (
    <div className="container mx-auto flex min-h-[calc(100vh-150px)] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-10 w-10 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold">Confirmation Failed</CardTitle>
          <CardDescription>
            {message || defaultMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground">
            Please try signing up again or contact the project coordinator if you continue to have issues.
          </p>
          <Button asChild variant="outline">
            <Link href="/projects" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              Browse Projects
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
