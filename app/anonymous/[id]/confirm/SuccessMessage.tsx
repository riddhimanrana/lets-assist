import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Home, Sparkles } from "lucide-react";
import Link from "next/link";

interface SuccessMessageProps {
  anonymousSignupId: string;
}

export function SuccessMessage({ anonymousSignupId }: SuccessMessageProps) {
  return (
    <section className="relative flex min-h-[calc(100vh-64px)] flex-col items-center justify-center overflow-hidden px-6 py-16 sm:px-8">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/10 via-background to-background" />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-60">
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-chart-5/30 blur-3xl" />
        <div className="absolute bottom-0 left-10 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-10 right-4 h-48 w-48 rounded-full bg-chart-4/30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-2xl rounded-3xl border border-border/40 bg-background/90 p-10 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-chart-5/15">
          <CheckCircle2 className="h-12 w-12 text-chart-5" />
        </div>
        <Badge variant="outline" className="mb-4 gap-1 px-3 py-1 text-sm font-medium uppercase tracking-wide">
          <Sparkles className="h-3.5 w-3.5" />
          Email Verified
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Email successfully confirmed</h1>
        <p className="mt-4 text-base text-muted-foreground sm:text-lg">
          Your spot is locked in and we&apos;ve notified the organizers. Thanks for taking the next step to support your community!
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
            <Link href={`/anonymous/${anonymousSignupId}`}>
              View signup details
            </Link>
          </Button>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/projects" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              Find another project
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
