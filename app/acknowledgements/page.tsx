import { LongFormPage } from "@/components/projects/LongFormPage";
import Link from "next/link";
import { Metadata } from "next";
import { siGithub } from "simple-icons";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { SimpleIcon } from "@/components/ui/simple-icon";

export const metadata: Metadata = {
  title: "Acknowledgements",
  description: "Acknowledgements for Let's Assist - creator and source code.",
};

export default function AcknowledgementsPage() {
  return (
    <LongFormPage
      title="Acknowledgements"
      meta="The people and resources that made Let's Assist possible"
    >
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
        <Link
          href="https://riddhimanrana.com"
          className="inline-flex items-center gap-1 font-medium"
        >
          Riddhiman Rana
          <ExternalLink className="size-4" aria-hidden="true" />
        </Link>
      </p>
      <p>
        You can read more about the creation of Let&apos;s Assist on my{" "}
        <Link href="https://riddhimanrana.com/blog/building-lets-assist">
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
          className="inline-flex items-center gap-1 font-medium"
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
    </LongFormPage>
  );
}
