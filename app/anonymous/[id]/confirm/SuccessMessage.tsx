import Link from "next/link";
import { CircleCheck } from "lucide-react";

import { ArrowRightIcon } from "@/components/icons/animated";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { NoticePage } from "@/components/projects/NoticePage";
import { buttonVariants } from "@/components/ui/button-variants";

interface SuccessMessageProps {
  anonymousSignupId: string;
  anonymousAccessToken: string;
}

export function SuccessMessage({
  anonymousSignupId,
  anonymousAccessToken,
}: SuccessMessageProps) {
  return (
    <NoticePage
      icon={<CircleCheck aria-hidden="true" />}
      tone="success"
      title="Email successfully confirmed"
      description="Your spot is locked in and we've notified the organizers."
      actions={
        <>
          <AnimatedLinkButton
            href={`/anonymous/${anonymousSignupId}?token=${encodeURIComponent(anonymousAccessToken)}`}
            icon={ArrowRightIcon}
            iconPosition="inline-end"
          >
            View signup details
          </AnimatedLinkButton>
          <Link
            href="/projects"
            className={buttonVariants({ variant: "outline" })}
          >
            Find another project
          </Link>
        </>
      }
    />
  );
}
