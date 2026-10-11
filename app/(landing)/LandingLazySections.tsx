"use client";

import dynamic from "next/dynamic";

import {
  OrgToolingDemoFallback,
  OrgToolingIntro,
} from "./_components/OrgToolingIntro";

const BayAreaExamples = dynamic(() => import("./_components/BayAreaExamples"), {
  loading: () => null,
  ssr: false,
});
// These two render on the server, so their copy and #anchors are in the first
// response. Each still ships as its own client chunk. No `loading` here: it
// would add a boundary that can stream the section in behind a script.
const ComparisonSection = dynamic(
  () => import("./_components/ComparisonSection"),
);
const VolunteerJourneySection = dynamic(
  () => import("./_components/VolunteerJourneySection"),
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
const TestimonialsSection = dynamic(
  () => import("./_components/TestimonialsSection"),
  { loading: () => null, ssr: false },
);
const RealCheckIn = dynamic(
  () => import("./_components/RealCheckIn").then((mod) => mod.RealCheckIn),
  { loading: () => null, ssr: false },
);
const CallToAction = dynamic(
  () => import("./_components/CallToAction").then((mod) => mod.CallToAction),
  { loading: () => null, ssr: false },
);

export function LandingLazySections() {
  return (
    <>
      <BayAreaExamples />
      <ComparisonSection />
      <RealCheckIn />
      <VolunteerJourneySection />
      <OrgToolingIntro>
        <OrgToolingDemo />
      </OrgToolingIntro>
      <TestimonialsSection />
      <CallToAction />
    </>
  );
}
