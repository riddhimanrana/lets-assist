"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
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

type AvailabilityStatus = "available" | "limited" | "unavailable";

function SubmitButton({ hydrated }: { hydrated: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={!hydrated || pending}>
      {pending ? "Recording availability…" : "Confirm availability"}
    </Button>
  );
}

export function GuardianAvailabilityForm({
  token,
  guardianName,
  tournamentName,
}: {
  token: string;
  guardianName: string;
  tournamentName: string;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<AvailabilityStatus>("available");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Confirm judging availability</CardTitle>
        <CardDescription>
          {guardianName} · {tournamentName}
        </CardDescription>
      </CardHeader>
      <form
        action={confirmGuardianAvailability}
        data-hydrated={hydrated ? "true" : "false"}
        aria-busy={!hydrated}
      >
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
                    checked={status === "available"}
                    onChange={() => setStatus("available")}
                    disabled={!hydrated}
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
                    checked={status === "limited"}
                    onChange={() => setStatus("limited")}
                    disabled={!hydrated}
                    className="border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 size-4 shrink-0 appearance-none rounded-full border shadow-xs outline-none checked:border-[5px] checked:border-primary focus-visible:ring-[3px]"
                  />
                  <FieldLabel htmlFor="limited">
                    Available for some rounds
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <input
                    type="radio"
                    name="status"
                    value="unavailable"
                    id="unavailable"
                    aria-label="Unavailable"
                    checked={status === "unavailable"}
                    onChange={() => setStatus("unavailable")}
                    disabled={!hydrated}
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
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={!hydrated}
                placeholder="Scheduling limitations or questions"
              />
            </Field>
          </FieldGroup>
          <noscript>
            JavaScript is required to submit this single-use availability form
            safely.
          </noscript>
        </CardContent>
        <CardFooter>
          <SubmitButton hydrated={hydrated} />
        </CardFooter>
      </form>
    </Card>
  );
}
