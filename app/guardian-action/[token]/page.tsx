import { AlertCircle, CheckCircle2 } from "lucide-react";
import { GuardianTokenService } from "@/lib/dv/guardian-token-service";
import { NoticePage } from "@/components/projects/NoticePage";
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
      <NoticePage
        icon={<CheckCircle2 aria-hidden="true" />}
        tone="success"
        title="Availability recorded"
        description="DV Speech & Debate staff can now use your response when reviewing judge coverage."
      />
    );
  }

  const result = await GuardianTokenService.inspect(token);
  if (!result.valid) {
    return (
      <NoticePage
        icon={<AlertCircle aria-hidden="true" />}
        title="Link unavailable"
        description="This guardian link is invalid, expired, or has already been used. Ask DV Speech & Debate staff for a new link."
      />
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
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-12 sm:px-6">
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
