"use client";

import { UserPlusIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface ProjectSignupCtaState {
  label: string;
  onClick: () => void;
  loading?: boolean;
}

/** The page's one filled action: sign up, or jump to the slot list. */
export function ProjectSignupCta({
  cta,
  className,
}: {
  cta: ProjectSignupCtaState;
  className?: string;
}) {
  const icon = useAnimatedIcon();

  return (
    <Button
      className={className}
      onClick={cta.onClick}
      disabled={cta.loading}
      {...icon.triggerProps}
    >
      {cta.loading ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <UserPlusIcon
          ref={icon.ref}
          size={16}
          data-icon="inline-start"
          aria-hidden="true"
        />
      )}
      {cta.label}
    </Button>
  );
}

/**
 * Keeps the sign-up action reachable on phones while the page scrolls. It is
 * sticky, not fixed, so it lets go when the site footer comes into view. As a
 * floating bar it is the one place on this screen that casts a shadow.
 */
export function ProjectSignupBar({
  title,
  detail,
  cta,
}: {
  title: string;
  detail?: string;
  cta: ProjectSignupCtaState;
}) {
  return (
    <div className="bg-background sticky bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] shadow-md lg:hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-sm font-medium">{title}</p>
          {detail ? (
            <p className="text-muted-foreground truncate text-sm">{detail}</p>
          ) : null}
        </div>
        <ProjectSignupCta cta={cta} className="shrink-0" />
      </div>
    </div>
  );
}
