"use client";

import { useActionState } from "react";

import { MailCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import {
  requestCsfUnsubscribeAction,
  type CsfUnsubscribeRequestState,
} from "./actions";

const initialState: CsfUnsubscribeRequestState = { submitted: false };

export function UnsubscribeRequestForm({
  organizationId,
  topicKey,
}: {
  organizationId: string;
  topicKey: string;
}) {
  const [state, formAction, pending] = useActionState(
    requestCsfUnsubscribeAction,
    initialState,
  );

  if (state.submitted) {
    return (
      <Alert variant="success">
        <MailCheck aria-hidden="true" />
        <AlertTitle>Check your inbox</AlertTitle>
        <AlertDescription>
          If that address receives our announcements, a confirmation email is on
          its way. Open it and click the confirmation link — it expires in 30
          minutes.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="topicKey" value={topicKey} />
      <Field data-invalid={Boolean(state.error)}>
        <FieldLabel htmlFor="unsubscribe-email">Email address</FieldLabel>
        <Input
          id="unsubscribe-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(state.error)}
        />
        {state.error ? <FieldError>{state.error}</FieldError> : null}
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send confirmation email"}
      </Button>
    </form>
  );
}
