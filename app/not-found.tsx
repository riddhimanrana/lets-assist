import Link from "next/link";

import { HomeIcon } from "@/components/icons/animated";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { NoticePage } from "@/components/projects/NoticePage";
import { buttonVariants } from "@/components/ui/button-variants";

export default function NotFound() {
  return (
    <NoticePage
      title="Page not found"
      description="The page you're looking for doesn't exist or has been moved."
      actions={
        <>
          <AnimatedLinkButton href="/" icon={HomeIcon}>
            Return home
          </AnimatedLinkButton>
          <Link
            href="/projects"
            className={buttonVariants({ variant: "outline" })}
          >
            Browse projects
          </Link>
        </>
      }
    >
      <p className="text-muted-foreground -order-1 text-sm font-medium tabular-nums">
        404
      </p>
    </NoticePage>
  );
}
