import { AlertCircle, CheckCircle2 } from "lucide-react";
import { GuardianTokenService } from "@/lib/dv/guardian-token-service";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { confirmGuardianAvailability } from "./actions";

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
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Confirm judging availability</CardTitle>
          <CardDescription>
            {guardian?.full_name ?? "Guardian"} ·{" "}
            {payload.tournamentName ?? "DV Speech & Debate tournament"}
          </CardDescription>
        </CardHeader>
        <form action={confirmGuardianAvailability}>
          <CardContent>
            <input type="hidden" name="token" value={token} />
            <FieldGroup>
              <Field>
                <FieldLabel id="availability-label">Availability</FieldLabel>
                <div
                  role="radiogroup"
                  aria-labelledby="availability-label"
                  className="grid w-full gap-3"
                >
                  <Field orientation="horizontal">
                    <input
                      type="radio"
                      name="status"
                      value="available"
                      id="available"
                      aria-label="Available"
                      defaultChecked
                      className="border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 size-4 shrink-0 appearance-none rounded-full border shadow-xs outline-none checked:border-[5px] checked:border-primary focus-visible:ring-[3px]"
                    />
                    <FieldLabel htmlFor="available">Available</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <input
                      type="radio"
                      name="status"
                      value="limited"
                      id="limited"
                      aria-label="Available for some rounds"
                      className="border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 size-4 shrink-0 appearance-none rounded-full border shadow-xs outline-none checked:border-[5px] checked:border-primary focus-visible:ring-[3px]"
                    />
                    <FieldLabel htmlFor="limited">Available for some rounds</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <input
                      type="radio"
                      name="status"
                      value="unavailable"
                      id="unavailable"
                      aria-label="Unavailable"
                      className="border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 size-4 shrink-0 appearance-none rounded-full border shadow-xs outline-none checked:border-[5px] checked:border-primary focus-visible:ring-[3px]"
                    />
                    <FieldLabel htmlFor="unavailable">Unavailable</FieldLabel>
                  </Field>
                </div>
                <FieldDescription>
                  Submitting consumes this single-purpose link.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="notes">Notes</FieldLabel>
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Scheduling limitations or questions"
                />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full">
              Confirm availability
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
