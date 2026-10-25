import { PageHeader } from "@/components/layout/PageHeader";
import Link from "next/link";
import type { Metadata } from "next";
import { siGithub } from "simple-icons";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { SimpleIcon } from "@/components/ui/simple-icon";
import { TEXT_LINK_CLASS } from "@/lib/text-link";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Acknowledgements",
  description: "Acknowledgements for Let's Assist - creator and source code.",
};

/** Reading rhythm for the two short sections below the page header. */
const PROSE_CLASS =
  "mt-6 border-t text-base leading-7 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:mt-3";

/** A standalone link that ends in the external-link icon. */
const ICON_LINK_CLASS = cn(TEXT_LINK_CLASS, "inline-flex items-center gap-1");

export default function AcknowledgementsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Acknowledgements"
        description="The people and resources that made Let's Assist possible"
      />
      <div className={PROSE_CLASS}>
        <h2 className="flex items-center gap-2">
          <Image
            src="/resources/riddhiman-rana-logo.webp"
            alt=""
            width={20}
            height={20}
          />
          Project creator
        </h2>
        <p className="text-muted-foreground text-sm">
          Initial idea, founder, and developer
        </p>
        <p>
          <Link href="https://riddhimanrana.com" className={ICON_LINK_CLASS}>
            Riddhiman Rana
            <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        </p>
        <p>
          You can read more about the creation of Let&apos;s Assist on my{" "}
          <Link
            href="https://riddhimanrana.com/blog/building-lets-assist"
            className={TEXT_LINK_CLASS}
          >
            blog post
          </Link>
          .
        </p>

        <h2 className="flex items-center gap-2">
          <SimpleIcon icon={siGithub} className="size-5" />
          Source code
        </h2>
        <p className="text-muted-foreground text-sm">View on GitHub</p>
        <p>
          <Link
            href="https://github.com/riddhimanrana/lets-assist"
            className={ICON_LINK_CLASS}
          >
            lets-assist
            <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        </p>
        <p>
          This is a solo project and I&apos;m currently not accepting
          contributions, however the code is still openly available for
          transparency.
        </p>
      </div>
    </div>
  );
}
