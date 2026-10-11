import { PAGE_CONTENT_ID } from "@/components/layout/content-targets";
import Link from "next/link";

import { HomeIcon } from "@/components/icons/animated";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { NoticePage } from "@/components/projects/NoticePage";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div id={PAGE_CONTENT_ID} tabIndex={-1} className="outline-none">
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
              className={cn(buttonVariants({ variant: "outline" }))}
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
    </div>
  );
}
