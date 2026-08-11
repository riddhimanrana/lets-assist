"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      <div className="border-border bg-muted/40 mt-6 rounded-lg border p-4 text-sm leading-6">
        If that address receives our announcements, a confirmation email is on
        its way. Open it and click the confirmation link — it expires in 30
        minutes.
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="topicKey" value={topicKey} />
      <div className="space-y-2">
        <Label htmlFor="unsubscribe-email">Email address</Label>
        <Input
          id="unsubscribe-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send confirmation email"}
      </Button>
    </form>
  );
}
