"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Key, BarChart3, Eye, ArrowRight } from "lucide-react";
import Link from "next/link";
import OrganizationHeader from "@/app/organization/[id]/OrganizationHeader";
import OrganizationTabs from "@/app/organization/[id]/OrganizationTabs";

const orgFeatures = [
  {
    icon: Key,
    title: "Join code system",
    desc: "6-digit codes + QR invite links. Members join via code or link; admins regenerate anytime.",
  },
  {
    icon: Users,
    title: "Member management",
    desc: "Role-based controls for admins, staff, members. Promote, remove, or view hours in seconds.",
  },
  {
    icon: BarChart3,
    title: "Individual insights",
    desc: "Date-range filters, exportable CSVs, and detailed impact cards for every volunteer.",
  },
  {
    icon: Eye,
    title: "Volunteer logs",
    desc: "Verified hours, certificate links, and session history surfaced in one clean table.",
  },
];

const mockOrganization = {
  id: "org_sanramon_1",
  name: "San Ramon City Alliance",
  username: "sanramon",
  type: "nonprofit",
  website: "https://www.sanramon.ca.gov/",
  verified: true,
  logo_url: "/logos/sanramon.jpg",
  description: "A community coalition connecting residents, schools, and local nonprofits to improve San Ramon through service and events. Note that this is a mock and is not affiliated with the actual City of San Ramon.",
  created_at: new Date().toISOString(),
};

const mockMembers = [
  {
    id: "m1",
    role: "admin",
    joined_at: new Date().toISOString(),
    user_id: "u1",
    organization_id: "org_sanramon_1",
    profiles: { id: "u1", username: "riddhiman", full_name: "Riddhiman Rana", avatar_url: null },
  },
  {
    id: "m2",
    role: "staff",
    joined_at: new Date().toISOString(),
    user_id: "u2",
    organization_id: "org_sanramon_1",
    profiles: { id: "u2", username: "maya.chen", full_name: "Maya Chen", avatar_url: null },
  },
  {
    id: "m3",
    role: "member",
    joined_at: new Date().toISOString(),
    user_id: "u3",
    organization_id: "org_sanramon_1",
    profiles: { id: "u3", username: "liam.oconnor", full_name: "Liam O'Connor", avatar_url: null },
  },
];

function oneTime(dateISO: string, start: string, end: string) {
  const date = dateISO.slice(0, 10);
  return { oneTime: { date, startTime: start, endTime: end, volunteers: 20 } };
}

const now = new Date();
const todayISO = new Date(now).toISOString();
const yesterdayISO = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
const tomorrowISO = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

const mockProjects = [
  {
    id: "p1",
    title: "Bollinger Canyon Creek Cleanup",
    location: "Bollinger Canyon Trailhead",
    created_at: todayISO,
    event_type: "oneTime",
    schedule: oneTime(tomorrowISO, "09:00", "12:00"),
    status: "upcoming",
    visibility: "public" as const,
    creator_id: "u1",
  },
  {
    id: "p2",
    title: "Dougherty Valley Senior Center Meals",
    location: "Dougherty Valley Senior Center",
    created_at: todayISO,
    event_type: "oneTime",
    schedule: oneTime(yesterdayISO, "11:00", "13:00"),
    status: "completed",
    visibility: "public" as const,
    creator_id: "u2",
  },
  {
    id: "p3",
    title: "Central Park Tree Planting",
    location: "San Ramon Central Park",
    created_at: todayISO,
    event_type: "oneTime",
    schedule: oneTime(todayISO, "08:00", "10:00"),
    status: "upcoming",
    visibility: "public" as const,
    creator_id: "u3",
  },
];

export default function OrgToolingSection() {
  return (
    <section id="org-tooling" className="py-16 sm:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="text-center mx-auto max-w-3xl"
        >
          <Badge variant="outline" className="mb-3 border-primary/40 bg-primary/10 text-primary">
            For organizations
          </Badge>
          <h2 className="font-overusedgrotesk text-3xl sm:text-4xl tracking-tight">
            The workspace SignUpGenius never built
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Run your volunteer program from one simple dashboard — no spreadsheets, no guesswork. Manage members and roles, verify hours with QR check‑ins, auto‑issue certificates, and export compliance-ready reports in seconds. Built for schools and nonprofits that need reliable, auditable volunteer records.
          </p>

        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="relative mx-auto mt-12 w-full max-w-6xl"
        >
          <div className="pointer-events-none absolute -inset-x-8 -inset-y-6 rounded-3xl bg-[radial-gradient(40%_30%_at_30%_20%,theme(colors.emerald.400/_18%),transparent_70%),radial-gradient(30%_25%_at_70%_10%,theme(colors.primary.DEFAULT/_16%),transparent_70%)] blur-2xl" />
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
        </motion.div>

        <div className="mt-12 space-y-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {orgFeatures.map((feat) => (
              <Card key={feat.title} className="h-full border-border/60 bg-background/90 shadow-sm">
                <CardContent className="p-4">
                  <div className="mb-2 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                    <feat.icon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{feat.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

            <div className="rounded-2xl border border-border/70 bg-muted/50 p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary/80">Why teams switch</p>
              <h3 className="mt-2 text-xl font-semibold text-foreground">
                Built-in tools SignUpGenius doesn’t offer
              </h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-prose">
                Attendance verification, auto-published certificates, member exports, and organization roles are all
                native here. No plug-ins, no workarounds.
              </p>
              </div>

              <ul className="grid gap-3 text-sm text-foreground sm:grid-cols-2">
              <li className="flex items-start gap-3">
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary whitespace-nowrap">Let's Assist</span>
                <span className="leading-relaxed">Verified QR check‑in/out with optional supervisor approvals</span>
              </li>

              <li className="flex items-start gap-3">
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary whitespace-nowrap">Let's Assist</span>
                <span className="leading-relaxed">Certificate automation + downloadable proof for students and volunteers</span>
              </li>

              <li className="flex items-start gap-3">
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary whitespace-nowrap">Let's Assist</span>
                <span className="leading-relaxed">Org roles (admin / staff / member) with audit‑ready exports and filters</span>
              </li>

              <li className="flex items-start gap-3 text-muted-foreground/80">
                <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">SignUpGenius</span>
                <span className="leading-relaxed">Sign-up lists only — no verified hours, certificates, or compliance features</span>
              </li>
              </ul>
            </div>
            </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
            <Button asChild size="lg" className="gap-2">
              <Link href="/trusted-member">
                Apply for trusted member access
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-2">
              <Link href="/organization">
                Explore organizations
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
