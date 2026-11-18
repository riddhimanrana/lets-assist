"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Link2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { canonicalSignUpGeniusUrl } from "@/lib/signupgenius/url";
import {
  importPreviewSchema,
  importPreviewToDraft,
  isHistoricalImport,
  type ImportPreview,
} from "@/lib/signupgenius/model";
import { storeImportPreview } from "@/lib/signupgenius/handoff";
import { IMPORT_ERROR_MESSAGES } from "@/lib/signupgenius/errors";
import { TEXT_LINK_CLASS } from "@/lib/text-link";
import ImportPreviewEditor from "./ImportPreviewEditor";

export default function SignUpGeniusImporter() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const handoffId = useRef<string | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      active.current?.abort();
    },
    [],
  );

  function reset() {
    generation.current++;
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setPreview(null);
    setError("");
    setReviewed(false);
    setContinuing(false);
    handoffId.current = null;
  }

  async function importSignup(event: FormEvent) {
    event.preventDefault();
    reset();
    let canonical: string;
    try {
      canonical = canonicalSignUpGeniusUrl(url);
    } catch {
      setError(IMPORT_ERROR_MESSAGES.invalid_url);
      return;
    }
    const version = generation.current;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/import/signupgenius", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: canonical }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(18000),
        ]),
      });
      const data = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Import is temporarily unavailable. Please try again.",
        );
        return;
      }
      const parsed = importPreviewSchema.safeParse(data.preview);
      if (!parsed.success) {
        setError(IMPORT_ERROR_MESSAGES.incomplete);
        return;
      }
      setPreview(parsed.data);
    } catch {
      if (version === generation.current)
        setError("We could not complete the import. Please try again.");
    } finally {
      if (version === generation.current) {
        setBusy(false);
        active.current = null;
      }
    }
  }

  function continueToReview(event: FormEvent) {
    event.preventDefault();
    if (!preview || !reviewed || continuing) return;
    try {
      const validated = importPreviewSchema.parse(preview);
      importPreviewToDraft(validated);
      const id = handoffId.current ?? crypto.randomUUID();
      handoffId.current = id;
      const destination = storeImportPreview(
        window.sessionStorage,
        id,
        validated,
      );
      setError("");
      setContinuing(true);
      router.push(destination);
    } catch {
      setError(
        "Check the timezone, dates, times, and capacities. Your browser must allow tab storage to continue.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Start with your signup link</CardTitle>
          <CardDescription>
            For organizers bringing their own event to Let's Assist. Public
            signups only; some formats cannot be imported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={importSignup} className="space-y-4">
            <Field>
              <FieldLabel htmlFor="signup-link">SignUpGenius link</FieldLabel>
              <Input
                id="signup-link"
                type="url"
                required
                maxLength={2048}
                placeholder="https://www.signupgenius.com/go/…"
                value={url}
                onChange={(e) => {
                  reset();
                  setUrl(e.target.value);
                }}
                aria-describedby="signup-link-help"
              />
              <FieldDescription id="signup-link-help">
                Desktop, mobile, and older http links are accepted.
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle
                    aria-hidden
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Link2 aria-hidden />
                )}{" "}
                {busy ? "Reading signup…" : "Preview import"}
              </Button>
              {busy && (
                <Button type="button" variant="outline" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              {busy
                ? "Reading public event details. You can cancel at any time."
                : "No project is created when you preview a signup."}
            </p>
          </form>
        </CardContent>
      </Card>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Import needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {preview && (
        <form onSubmit={continueToReview} className="space-y-5">
          <p className="text-sm">
            <a
              href={preview.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={TEXT_LINK_CLASS}
            >
              Compare with the original signup
            </a>
          </p>
          {isHistoricalImport(preview) && (
            <Alert variant="warning">
              <AlertTitle>This signup includes past dates</AlertTitle>
              <AlertDescription>
                We kept the original dates. Confirm your intended event dates
                before continuing; nothing has been moved to the future.
              </AlertDescription>
            </Alert>
          )}
          <ImportPreviewEditor
            preview={preview}
            onChange={(next) => {
              setPreview(next);
              setReviewed(false);
            }}
          />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-primary"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              required
            />
            <span>
              I am authorized to organize this event and have checked its dates,
              timezone, location, and total slot capacities.
            </span>
          </label>
          <Button type="submit" disabled={!reviewed || continuing}>
            {continuing
              ? "Opening project review…"
              : "Continue to project review"}
            <ArrowRight aria-hidden />
          </Button>
          <p className="text-sm text-muted-foreground">
            Sign in to continue in the project editor. Your preview stays in
            this browser tab for up to 24 hours. You decide when to save or
            publish through the usual project review.
          </p>
        </form>
      )}
      <div className="flex items-start gap-3 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p>
          Only event details and slot capacities are imported. Participant
          names, contact details, comments, and existing signups stay behind.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Prefer to start fresh?{" "}
        <Link href="/projects/create" className={TEXT_LINK_CLASS}>
          Create a project manually
        </Link>
        .
      </p>
    </div>
  );
}
