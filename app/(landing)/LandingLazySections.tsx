"use client";

import dynamic from "next/dynamic";

const BayAreaExamples = dynamic(() => import("./_components/BayAreaExamples"), {
  loading: () => null,
  ssr: false,
});
const ComparisonSection = dynamic(
  () => import("./_components/ComparisonSection"),
  { loading: () => null, ssr: false },
);
const VolunteerJourneySection = dynamic(
  () => import("./_components/VolunteerJourneySection"),
  { loading: () => null, ssr: false },
);
const PlatformFeaturesSection = dynamic(
  () => import("./_components/PlatformFeaturesSection"),
  { loading: () => null, ssr: false },
);
const OrgToolingSection = dynamic(
  () => import("./_components/OrgToolingSection"),
  {
    loading: () => null,
    ssr: false,
  },
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
      <VolunteerJourneySection />
      <PlatformFeaturesSection />
      <OrgToolingSection />
      <CallToAction />
    </>
  );
}