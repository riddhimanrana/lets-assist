"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { setLandingDemoMode } from "@/app/admin/server/landing-demo-mode";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Fixed copy. The server's error text never reaches the page.
const LOAD_ERROR = "Unable to load landing page mode. Reload to try again.";
const SAVE_ERROR =
  "The landing page mode was not saved. Reload to check the current mode, then try again.";

/**
 * Switches the public landing page between real content and the fictional
 * demo preview for every visitor. Nothing else changes: home dashboards and
 * real projects keep their data.
 *
 * The switch is not optimistic. It shows the last mode the server confirmed
 * and moves only after a save succeeds, so the status line never reports a
 * mode that was not saved. `enabled` is `null` when the mode could not be
 * read, and the switch stays disabled until a reload reads it.
 */
export function LandingDemoControl({
  enabled,
  className,
}: {
  enabled: boolean | null;
  className?: string;
}) {
  const router = useRouter();
  const id = useId();
  const switchId = `${id}-switch`;
  const labelId = `${id}-label`;
  const scopeId = `${id}-scope`;
  const errorId = `${id}-error`;

  const [failed, setFailed] = useState(false);
  const [saving, startSave] = useTransition();
  const [reloading, startReload] = useTransition();
  // The pending flags update on the next render. The ref also stops a second
  // toggle that arrives before it.
  const inFlight = useRef(false);

  // A refreshed page can pass a new `enabled`. Adopt it during render rather
  // than in an effect, so the stale mode and its error never paint.
  const [lastEnabled, setLastEnabled] = useState(enabled);
  if (enabled !== lastEnabled) {
    setLastEnabled(enabled);
    setFailed(false);
  }

  const mode = enabled;
  const busy = saving || reloading;
  const error = mode === null ? LOAD_ERROR : failed ? SAVE_ERROR : null;

  const save = (next: boolean) => {
    if (mode === null || inFlight.current) return;
    inFlight.current = true;
    setFailed(false);
    startSave(async () => {
      try {
        // The server rejects the save when the mode is no longer `mode`.
        const result = await setLandingDemoMode(next, mode);
        if (result.error) {
          setFailed(true);
          return;
        }
        // Back inside a transition after the await, so the switch stays
        // disabled until the refreshed page is ready.
        startSave(() => {
          router.refresh();
        });
      } catch {
        setFailed(true);
      } finally {
        inFlight.current = false;
      }
    });
  };

  // Always display the refreshed server value, including a concurrent revert.
  const reload = () => {
    if (inFlight.current) return;
    startReload(() => {
      setFailed(false);
      router.refresh();
    });
  };

  return (
    <div
      data-slot="landing-demo-control"
      className={cn(
        "bg-card text-card-foreground grid min-w-0 gap-3 rounded-lg border px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <Label id={labelId} htmlFor={switchId} className="leading-snug">
            Demo preview on the landing page
          </Label>
          <p id={scopeId} className="text-muted-foreground text-sm">
            Applies to everyone visiting the public landing page. Home
            dashboards and real projects stay unchanged.
          </p>
        </div>
        <Switch
          id={switchId}
          className="mt-0.5"
          checked={mode === true}
          disabled={mode === null || busy}
          onCheckedChange={save}
          aria-labelledby={labelId}
          aria-describedby={error ? `${scopeId} ${errorId}` : scopeId}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          role="status"
          className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
        >
          {busy ? (
            <>
              <Spinner
                aria-hidden="true"
                className="size-3.5 motion-reduce:animate-none"
              />
              <span className="text-muted-foreground">
                {saving ? "Saving" : "Reloading"}
              </span>
            </>
          ) : mode === null ? (
            <Badge variant="neutral">Mode unavailable</Badge>
          ) : mode ? (
            <>
              <Badge variant="info" className="text-foreground">
                Demo preview
              </Badge>
              <span className="text-muted-foreground">
                Sample content. Fictional, not Let&apos;s Assist data.
              </span>
            </>
          ) : (
            <Badge variant="outline">Real content</Badge>
          )}
        </div>
        <Link
          href="/?noRedirect=1"
          prefetch={false}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "ml-auto",
          )}
        >
          Open landing page
        </Link>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p
            id={errorId}
            role="alert"
            className="text-destructive min-w-0 flex-1 basis-48 text-sm"
          >
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={reload}
          >
            Reload
          </Button>
        </div>
      ) : null}
    </div>
  );
}
