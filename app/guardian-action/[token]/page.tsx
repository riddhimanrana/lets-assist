import { AlertCircle, CheckCircle2 } from "lucide-react";
import { GuardianTokenService } from "@/lib/dv/guardian-token-service";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GuardianAvailabilityForm } from "./GuardianAvailabilityForm";

export default async function GuardianActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ completed?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (query.completed === "1") {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Availability recorded</AlertTitle>
          <AlertDescription>
            DV Speech & Debate staff can now use your response when reviewing
            judge coverage.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const result = await GuardianTokenService.inspect(token);
  if (!result.valid) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
        <Alert>
          <AlertCircle />
          <AlertTitle>Link unavailable</AlertTitle>
          <AlertDescription>
            This guardian link is invalid, expired, or has already been used.
            Ask DV Speech & Debate staff for a new link.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const guardianRelation = result.action.dv_sd_guardians as
    | { full_name?: string | null; email?: string | null }
    | { full_name?: string | null; email?: string | null }[]
    | null;
  const guardian = Array.isArray(guardianRelation)
    ? guardianRelation[0]
    : guardianRelation;
  const payload = result.action.payload as {
    tournamentName?: string;
    rounds?: string[];
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <GuardianAvailabilityForm
        token={token}
        guardianName={guardian?.full_name ?? "Guardian"}
        tournamentName={
          payload.tournamentName ?? "DV Speech & Debate tournament"
        }
      />
    </main>
  );
}
