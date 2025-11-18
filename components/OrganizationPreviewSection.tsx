"use client";

import { motion } from "framer-motion";
import OrganizationHeader from "@/app/organization/[id]/OrganizationHeader";
import OrganizationTabs from "@/app/organization/[id]/OrganizationTabs";

// Mock organization shaped to match OrganizationHeader/OrganizationTabs expectations
const mockOrganization = {
  id: "org_mock_1",
  name: "San Ramon City Alliance",
  username: "sanramon-city-alliance",
  type: "school",
  website: "https://evergreenhs.edu/keyclub",
  verified: true,
  logo_url: "/logos/sanramon.jpg",
  description: "Student-led community service club empowering youth leaders.",
  created_at: new Date().toISOString(),
};

// Members entries include role and profiles object (subset used by tabs)
const mockMembers = [
  {
    id: "m1",
    role: "admin",
    joined_at: new Date().toISOString(),
    user_id: "u1",
    organization_id: "org_mock_1",
    profiles: { id: "u1", username: "alex", full_name: "Alex Student", avatar_url: null },
  },
  {
    id: "m2",
    role: "staff",
    joined_at: new Date().toISOString(),
    user_id: "u2",
    organization_id: "org_mock_1",
    profiles: { id: "u2", username: "priya", full_name: "Priya S.", avatar_url: null },
  },
  {
    id: "m3",
    role: "member",
    joined_at: new Date().toISOString(),
    user_id: "u3",
    organization_id: "org_mock_1",
    profiles: { id: "u3", username: "diego", full_name: "Diego R.", avatar_url: null },
  },
];

// Helper to build one-time schedule blocks
function oneTime(dateISO: string, start: string, end: string) {
  const date = dateISO.slice(0, 10);
  return { oneTime: { date, startTime: start, endTime: end, volunteers: 20 } };
}

const now = new Date();
const todayISO = new Date(now).toISOString();
const yesterdayISO = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
const tomorrowISO = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

// Projects with minimal fields used by tabs and getProjectStatus
const mockProjects = [
  {
    id: "p1",
    title: "Community Park Clean-up",
    location: "Central Park",
    created_at: todayISO,
    event_type: "oneTime",
    schedule: oneTime(tomorrowISO, "09:00", "12:00"), // upcoming
    status: "upcoming",
    is_private: false,
    creator_id: "u1",
  },
  {
    id: "p2",
    title: "Senior Center Meals",
    location: "Downtown Senior Center",
    created_at: todayISO,
    event_type: "oneTime",
    schedule: oneTime(yesterdayISO, "11:00", "13:00"), // completed
    status: "completed",
    is_private: false,
    creator_id: "u2",
  },
  {
    id: "p3",
    title: "Tree Planting Day",
    location: "Evergreen High",
    created_at: todayISO,
    event_type: "oneTime",
    schedule: oneTime(todayISO, "08:00", "10:00"), // depends on current time
    status: "upcoming",
    is_private: false,
    creator_id: "u3",
  },
];

export default function OrganizationPreviewSection() {
  return (
    <section className="py-12 sm:py-16">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-2xl mb-6"
        >
          <h2 className="font-overusedgrotesk text-2xl sm:text-3xl tracking-tight">For organizations</h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground">
            This is the real organization UI—header and tabs—with mock data.
          </p>
        </motion.div>

        {/* Reconstructed using actual components with landing-ready chrome */}
        <div className="relative mx-auto w-full max-w-7xl">
          {/* Subtle green gradient halo */}
          <div className="pointer-events-none absolute -inset-x-6 -inset-y-6 rounded-3xl bg-[radial-gradient(40%_30%_at_30%_20%,theme(colors.emerald.400/_18%),transparent_70%),radial-gradient(30%_25%_at_70%_10%,theme(colors.primary.DEFAULT/_16%),transparent_70%)] blur-2xl" />

          {/* Framed container */}
          <div className="relative rounded-2xl border border-primary/20 bg-card/90 shadow-2xl backdrop-blur-sm">
            <div className="p-4 sm:p-6">
              <OrganizationHeader
                organization={mockOrganization}
                userRole={null}
                memberCount={mockMembers.length}
              />
              <div className="mt-6">
                <OrganizationTabs
                  organization={mockOrganization}
                  members={mockMembers}
                  projects={mockProjects}
                  userRole={null}
                  currentUserId={undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
