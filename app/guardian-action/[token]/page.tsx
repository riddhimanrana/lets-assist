import { AlertCircle, CheckCircle2 } from "lucide-react";
import { GuardianTokenService } from "@/lib/plugins/private/plugins/dv-speech-debate/services/guardian-token-service";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
                <FieldLabel>Availability</FieldLabel>
                <RadioGroup name="status" defaultValue="available">
                  <Field orientation="horizontal">
                    <RadioGroupItem value="available" id="available" />
                    <FieldLabel htmlFor="available">Available</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="limited" id="limited" />
                    <FieldLabel htmlFor="limited">Available for some rounds</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="unavailable" id="unavailable" />
                    <FieldLabel htmlFor="unavailable">Unavailable</FieldLabel>
                  </Field>
                </RadioGroup>
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
