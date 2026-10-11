import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HomeDemoExperience } from "@/components/home/HomeDemoExperience";
import { HomeDemoPreview } from "@/components/home/HomeDemoPreview";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { HOME_DEMO_SAMPLE_PROFILE } from "@/components/home/home-demo-data";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { isHomeDemoEnabled } from "@/lib/home/demo-flag";

export const metadata: Metadata = {
  title: "Home demo preview",
  robots: { index: false, follow: false },
};

// The flag is read per request, so a build can never bake the demo in.
export const dynamic = "force-dynamic";

/**
 * A fictional preview of the friendlier home page. It reads no account, no
 * session, and no database, so it grants nothing and shows nothing real. It
 * 404s unless the home demo flag is on in local development or a preview
 * deployment.
 */
export default function HomeDemoPreviewPage() {
  if (!isHomeDemoEnabled(process.env)) notFound();

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6">
      <PageHeader
        title={<HomeGreeting name={HOME_DEMO_SAMPLE_PROFILE.name} />}
        description="A preview of a friendlier home page, built from made-up content."
        meta={
          <>
            <Badge variant="outline">{HOME_DEMO_SAMPLE_PROFILE.label}</Badge>
            <span>
              {HOME_DEMO_SAMPLE_PROFILE.name} is a made-up person, not an
              account.
            </span>
          </>
        }
      />
      <HomeDemoExperience showGreeting={false} />
      <HomeDemoPreview />
    </div>
  );
}
