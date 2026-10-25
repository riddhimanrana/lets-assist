import { CircleAlert } from "lucide-react";

import { CompassIcon } from "@/components/icons/animated";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { NoticePage } from "@/components/projects/NoticePage";

interface ErrorMessageProps {
  message?: string; // Optional specific error message
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  const defaultMessage =
    "We couldn't confirm your signup. The confirmation link might be invalid, expired, or already used.";

  return (
    <NoticePage
      icon={<CircleAlert aria-hidden="true" />}
      tone="destructive"
      title="Confirmation failed"
      description={message || defaultMessage}
      actions={
        <AnimatedLinkButton href="/projects" icon={CompassIcon}>
          Browse projects
        </AnimatedLinkButton>
      }
    >
      <p className="text-muted-foreground text-sm">
        Please try signing up again or contact the project coordinator if you
        continue to have issues.
      </p>
    </NoticePage>
  );
}
