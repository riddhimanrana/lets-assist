"use client";

import dynamic from "next/dynamic";

import { CallToAction } from "./_components/CallToAction";
import {
  OrgToolingDemoFallback,
  OrgToolingIntro,
} from "./_components/OrgToolingIntro";

// The partner tiles are tooltip triggers. Their ids and trigger props come
// from a store that effects fill in, and that first render has not been
// reviewed for hydration, so the section stays client-only.
const BayAreaExamples = dynamic(() => import("./_components/BayAreaExamples"), {
  loading: () => null,
  ssr: false,
});
// These render on the server, so their copy and #anchors are in the first
// response. Each still ships as its own client chunk. No `loading` here: it
// would add a boundary that can stream the section in behind a script.
const ComparisonSection = dynamic(
  () => import("./_components/ComparisonSection"),
);
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
const TestimonialsSection = dynamic(
  () => import("./_components/TestimonialsSection"),
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
