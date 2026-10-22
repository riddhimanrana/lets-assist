"use client";

import dynamic from "next/dynamic";

import { CallToAction } from "./_components/CallToAction";
import {
  OrgToolingDemoFallback,
  OrgToolingIntro,
} from "./_components/OrgToolingIntro";

// These sections render their copy in the first response. The partner list no
// longer depends on a client-only tooltip store.
const BayAreaExamples = dynamic(() => import("./_components/BayAreaExamples"));
const VolunteerJourneySection = dynamic(
  () => import("./_components/VolunteerJourneySection"),
);
// Static markup only: images, copy and an inline drawing. Neither reads the
// viewport, the clock, a motion preference or any other browser state, so the
// server and the client produce the same tree. Including their markup in the
// response avoids inserting these sections only after their chunks arrive.
const RealCheckIn = dynamic(() =>
  import("./_components/RealCheckIn").then((mod) => mod.RealCheckIn),
);
// The organization mock mounts the real organization screens, which read the
// viewport and the clock, so it stays client-only. Only the mock is behind
// this boundary: OrgToolingIntro renders around it on the server, so the
// heading, features and links are never replaced when the chunk arrives.
const OrgToolingDemo = dynamic(
  () => import("./_components/OrgToolingSection"),
  {
    loading: () => <OrgToolingDemoFallback />,
    ssr: false,
  },
);
export function LandingLazySections() {
  return (
    <>
      <VolunteerJourneySection />
      <OrgToolingIntro>
        <OrgToolingDemo />
      </OrgToolingIntro>
      <RealCheckIn />
      <BayAreaExamples />
      {/* Quote permissions need confirmation before testimonials return here. */}
      <CallToAction />
    </>
  );
}
