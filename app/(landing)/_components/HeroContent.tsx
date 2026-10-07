"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  MapPin,
  QrCode,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ProjectSignupForm } from "@/app/projects/[id]/ProjectForm";
import ProjectDetails from "@/app/projects/[id]/ProjectDetails";
import {
  SlotAttendeesDropdown,
  type SlotAttendee,
} from "@/components/projects/SlotAttendeesDropdown";
import type { AnonymousSignupData, Organization, Project } from "@/types";
import type { ProjectCreatorProfileRecord } from "@/lib/profile/public";
import { AnimatedText } from "./AnimatedText";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { landingDemoAssets } from "./landing-demo-assets";

const {
  projectId: PROJECT_ID,
  projectImage: PROJECT_IMAGE,
  coordinatorImage: COORDINATOR_IMAGE,
} = landingDemoAssets(process.env.NEXT_PUBLIC_SUPABASE_URL);
const PROJECT_HREF = `/projects/${PROJECT_ID}`;
const PROJECT_DISPLAY_URL = `lets-assist.com/projects/${PROJECT_ID}`;

const attendees = [
  { name: "Maya", avatar: "/demo/avatars/maya-chen.png" },
  { name: "Jordan", avatar: "/demo/avatars/jordan-lee.png" },
  { name: "Avery", avatar: "/demo/avatars/avery-patel.png" },
  { name: "Priya", avatar: "/demo/avatars/priya-shah.png" },
  { name: "Anonymous", avatar: null },
];

const slotAttendees: Record<string, SlotAttendee[]> = {
  "East Side Beach Cleanup": [
    {
      signup_id: "demo-east-1",
      schedule_id: "east",
      user_id: null,
      full_name: "Anonymous Volunteer",
      username: "",
      avatar_url: "",
      volunteer_comment: "Bringing gloves and trash bags.",
      is_anonymous: true,
      anonymous_name: "Anonymous Volunteer",
    },
    {
      signup_id: "demo-east-2",
      schedule_id: "east",
      user_id: null,
      full_name: "Maya C.",
      username: "",
      avatar_url: "",
      volunteer_comment: "Can help sort recycling.",
      is_anonymous: true,
      anonymous_name: "Maya C.",
    },
    {
      signup_id: "demo-east-3",
      schedule_id: "east",
      user_id: null,
      full_name: "Jordan",
      username: "",
      avatar_url: "",
      volunteer_comment: "",
      is_anonymous: true,
      anonymous_name: "Jordan",
    },
  ],
  "West Side Beach Cleanup": [
    {
      signup_id: "demo-west-1",
      schedule_id: "west",
      user_id: null,
      full_name: "Avery",
      username: "",
      avatar_url: "",
      volunteer_comment: "Joining with two friends.",
      is_anonymous: true,
      anonymous_name: "Avery",
    },
    {
      signup_id: "demo-west-2",
      schedule_id: "west",
      user_id: null,
      full_name: "Anonymous Volunteer",
      username: "",
      avatar_url: "",
      volunteer_comment: "",
      is_anonymous: true,
      anonymous_name: "Anonymous Volunteer",
    },
  ],
};

const platformHighlights = [
  {
    icon: QrCode,
    title: "QR-Code Verification at events",
    desc: "Check volunteers in on-site and keep attendance tied to the project record.",
  },
  {
    icon: BadgeCheck,
    title: "Track all your volunteer hours in one place",
    desc: "Verified, pending, and self-reported service hours stay organized together.",
  },
  {
    icon: null,
    title: "Google Sheets/Calendar Syncing",
    desc: "Push project rosters and dates into the tools your organization already uses.",
    logos: [
      {
        src: "/resources/google-sheets-logo-2026.png",
        alt: "Google Sheets",
      },
      {
        src: "/resources/google-calendar-logo-2026.png",
        alt: "Google Calendar",
      },
    ],
  },
];

function getFutureProjectDate() {
  const date = new Date();
  date.setDate(date.getDate() + 31);
  const day = date.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7;
  date.setDate(date.getDate() + daysUntilSaturday);
  return date;
}

function formatProjectDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

type MotionLinkButtonProps = {
  href: string;
  children: React.ReactNode;
  tone?: "solid" | "outline";
  className?: string;
};

function MotionLinkButton({
  href,
  children,
  tone = "solid",
  className,
}: MotionLinkButtonProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className="w-full sm:w-auto"
      initial={false}
      whileHover={shouldReduceMotion ? undefined : "hover"}
      whileTap={shouldReduceMotion ? undefined : "tap"}
      variants={{
        hover: { y: -2 },
        tap: { y: 1, scale: 0.985 },
      }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
    >
      <Button
        asChild
        variant={tone === "solid" ? "default" : "outline"}
        className={cn(
          "group relative h-11 w-full overflow-hidden rounded-full px-5 text-sm font-medium shadow-xs sm:w-auto",
          tone === "solid"
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "border-border bg-background/80 text-foreground backdrop-blur hover:bg-accent",
          className,
        )}
      >
        <Link href={href}>
          <span className="relative grid h-full place-items-center overflow-hidden">
            <motion.span
              className="inline-flex items-center gap-2"
              variants={{
                hover: { y: "-140%" },
                tap: { y: "-140%" },
              }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.span>
            <motion.span
              aria-hidden
              className="absolute inline-flex items-center gap-2"
              initial={{ y: "140%" }}
              variants={{
                hover: { y: 0 },
                tap: { y: 0 },
              }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.span>
          </span>
        </Link>
      </Button>
    </motion.div>
  );
}

function ProjectSlotCard({
  title,
  time,
  spots,
  progress,
  onSignup,
}: {
  title: string;
  time: string;
  spots: string;
  progress: string;
  onSignup: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card/50 p-3 transition-colors hover:bg-card/80 sm:p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
          <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground sm:text-sm">
            <div className="flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" />
              <span>{time}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                PDT
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 shrink-0" />
              <span>{spots}</span>
            </div>
          </div>
        </div>
        <Button size="sm" className="w-full sm:w-auto" onClick={onSignup}>
          Sign Up
        </Button>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: progress }}
          transition={{ duration: 0.8, delay: 0.1 }}
        />
      </div>
      <SlotAttendeesDropdown attendees={slotAttendees[title] ?? []} />
    </div>
  );
}

function SignupRequirement({
  icon: Icon,
  children,
}: {
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <Badge variant="secondary" className="gap-1.5 rounded-full font-normal">
      <Icon className="size-3" />
      {children}
    </Badge>
  );
}

export function ProjectDemo() {
  const shouldReduceMotion = useReducedMotion();
  const [signupDialogOpen, setSignupDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState("East Side Beach Cleanup");
  const [demoSubmitted, setDemoSubmitted] = useState(false);
  const projectDate = useMemo(() => getFutureProjectDate(), []);
  const formattedDate = formatProjectDate(projectDate);
  const signupSlots = [
    {
      title: "East Side Beach Cleanup",
      time: "9:00 AM - 12:00 PM",
      spots: "14 of 25 spots left",
      progress: "44%",
    },
    {
      title: "West Side Beach Cleanup",
      time: "1:00 PM - 4:00 PM",
      spots: "9 of 25 spots left",
      progress: "64%",
    },
  ];

  const openDemoSignup = (slotTitle: string) => {
    setSelectedSlot(slotTitle);
    setDemoSubmitted(false);
    setSignupDialogOpen(true);
  };

  const handleDemoSubmit = (_values: AnonymousSignupData) => {
    setDemoSubmitted(true);
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 28, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto w-full max-w-6xl"
    >
      <Card className="relative overflow-hidden border shadow-2xl shadow-primary/5">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className="p-4 sm:p-6 lg:p-8">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <Badge className="gap-1.5 rounded-full bg-success/15 text-success hover:bg-success/15">
                  <CheckCircle2 className="size-3" />
                  Open for signups
                </Badge>
                <Badge variant="outline" className="rounded-full">
                  Anonymous signups allowed
                </Badge>
                <Badge variant="outline" className="rounded-full">
                  Public attendee list
                </Badge>
              </div>

              <Link href={PROJECT_HREF} className="group block">
                <h2 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
                  Santa Cruz Beach Cleanup
                </h2>
              </Link>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="size-4" />
                Santa Cruz Beach Boardwalk Parking
              </p>

              <Card className="mt-6 shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    About this Project
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm leading-7 text-muted-foreground">
                  Join a community beach cleanup in Santa Cruz. Volunteers split
                  into shoreline teams, collect debris, sort supplies, and log
                  verified service hours with certificate-ready proof.
                </CardContent>
              </Card>

              <Card className="mt-4 shadow-none">
                <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
                  <CardTitle className="text-base">
                    Volunteer Opportunities
                  </CardTitle>
                  <Button asChild variant="outline" size="sm">
                    <Link href={PROJECT_HREF}>How It Works</Link>
                  </Button>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 pt-0">
                  <p className="text-sm font-medium">{formattedDate}</p>
                  {signupSlots.map((slot) => (
                    <ProjectSlotCard
                      key={slot.title}
                      title={slot.title}
                      time={slot.time}
                      spots={slot.spots}
                      progress={slot.progress}
                      onSignup={() => openDemoSignup(slot.title)}
                    />
                  ))}
                </CardContent>
              </Card>
            </div>

            <aside className="border-t bg-muted/20 p-4 sm:p-6 lg:border-l lg:border-t-0">
              <Card className="overflow-hidden shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Project Details</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-2 text-sm text-muted-foreground">
                    Project Image
                  </p>
                  <Link
                    href={PROJECT_HREF}
                    className="group relative block aspect-video overflow-hidden rounded-xl border bg-muted"
                  >
                    <Image
                      src={PROJECT_IMAGE}
                      alt="Santa Cruz Beach Cleanup"
                      fill
                      priority
                      loading="eager"
                      sizes="(min-width: 1024px) 360px, 90vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <span className="absolute bottom-3 right-3 rounded-full bg-background/90 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm backdrop-blur">
                      View
                    </span>
                  </Link>

                  <div className="mt-5">
                    <p className="mb-3 text-sm text-muted-foreground">
                      Project Coordinator
                    </p>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage
                          src={COORDINATOR_IMAGE}
                          alt="Riddhiman Rana"
                        />
                        <AvatarFallback>RR</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-semibold">Riddhiman Rana</p>
                        <p className="text-sm text-muted-foreground">
                          @riddhimanrana
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="my-5 h-px bg-border" />

                  <div>
                    <p className="mb-3 text-sm text-muted-foreground">
                      Signed up
                    </p>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex -space-x-2">
                        {attendees.map((attendee) => (
                          <Avatar
                            key={attendee.name}
                            className="size-9 border-2 border-card"
                          >
                            {attendee.avatar ? (
                              <AvatarImage
                                src={attendee.avatar}
                                alt={attendee.name}
                              />
                            ) : null}
                            <AvatarFallback>
                              {attendee.name.slice(0, 1)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      <p className="text-sm font-medium">+32 more</p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <SignupRequirement icon={Users}>
                      Anonymous signups
                    </SignupRequirement>
                    <SignupRequirement icon={FileText}>
                      Waiver
                    </SignupRequirement>
                    <SignupRequirement icon={QrCode}>
                      QR check-in
                    </SignupRequirement>
                  </div>

                  <Button asChild variant="outline" className="mt-5 w-full">
                    <Link href={PROJECT_HREF}>
                      <Mail data-icon="inline-start" />
                      Contact Project Coordinator
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={signupDialogOpen}
        onOpenChange={(open) => {
          setSignupDialogOpen(open);
          if (!open) {
            setDemoSubmitted(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Quick Sign Up</DialogTitle>
            <DialogDescription>
              {selectedSlot} for Santa Cruz Beach Cleanup. This is the same
              anonymous signup flow used on public project pages.
            </DialogDescription>
          </DialogHeader>
          {demoSubmitted ? (
            <div className="space-y-4">
              <Alert className="border-primary/30 bg-primary/5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <AlertTitle>This is just a demo.</AlertTitle>
                <AlertDescription>
                  No signup was created. On a live project, this form confirms
                  the volunteer by email and updates the project roster.
                </AlertDescription>
              </Alert>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => setSignupDialogOpen(false)}
                >
                  Close
                </Button>
                <Button asChild>
                  <Link href={PROJECT_HREF}>Open the real project</Link>
                </Button>
              </div>
            </div>
          ) : (
            <ProjectSignupForm
              onSubmit={handleDemoSubmit}
              onCancel={() => setSignupDialogOpen(false)}
              showCommentField
              enableSavedInfoReuse={false}
              projectId={PROJECT_ID}
              waiverRequired={false}
            />
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function getFutureDateString(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function buildDemoProject(): {
  project: Project;
  creator: ProjectCreatorProfileRecord;
  organization: Organization;
  attendees: SlotAttendee[];
} {
  const dayOne = getFutureDateString(31);
  const dayTwo = getFutureDateString(32);

  const organization: Organization = {
    id: "demo-org-dvhs",
    name: "Dougherty Valley High School",
    username: "dvhs",
    type: "school",
    verified: true,
    logo_url: "/logos/dvhs.png",
    description: "Demo organization for the landing page.",
  };

  const creator: ProjectCreatorProfileRecord = {
    id: "demo-creator",
    username: "riddhimanrana",
    full_name: "Riddhiman Rana",
    avatar_url: COORDINATOR_IMAGE,
    email: "riddhiman.rana@gmail.com",
    created_at: "2024-01-01T00:00:00.000Z",
    profile_visibility: "public",
    trusted_member: true,
  };

  const project: Project = {
    id: "demo-santa-cruz-cleanup",
    title: "Santa Cruz Beach Cleanup",
    description:
      "Join us for a community beach cleanup event in Santa Cruz. We will have multiple cleanup teams across the boardwalk, shoreline, and sorting station. All supplies will be provided. Please wear comfortable clothing and closed-toe shoes.",
    location: "Santa Cruz Beach Boardwalk Parking",
    location_data: {
      text: "515 Beach St, Santa Cruz, CA 95060, USA",
      display_name: "Santa Cruz Beach Boardwalk Parking",
      coordinates: {
        latitude: 36.9642,
        longitude: -122.0246,
      },
    },
    event_type: "multiDay",
    verification_method: "qr-code",
    require_login: false,
    enable_volunteer_comments: true,
    show_attendees_publicly: true,
    waiver_required: false,
    creator_id: creator.id,
    schedule: {
      multiDay: [
        {
          date: dayOne,
          slots: [
            {
              name: "Morning shoreline team",
              startTime: "09:00",
              endTime: "11:30",
              volunteers: 25,
            },
            {
              name: "Supply table",
              startTime: "10:00",
              endTime: "13:00",
              volunteers: 8,
            },
          ],
        },
        {
          date: dayTwo,
          slots: [
            {
              name: "Afternoon cleanup team",
              startTime: "13:00",
              endTime: "16:00",
              volunteers: 25,
            },
            {
              name: "Recycling sort station",
              startTime: "15:00",
              endTime: "17:00",
              volunteers: 12,
            },
          ],
        },
      ],
    },
    status: "upcoming",
    visibility: "public",
    organization_id: organization.id,
    organization,
    pause_signups: false,
    profiles: {
      full_name: creator.full_name,
      email: creator.email,
      avatar_url: creator.avatar_url,
      username: creator.username,
      created_at: creator.created_at,
      profile_visibility: "public",
    },
    created_at: "2024-01-01T00:00:00.000Z",
    cover_image_url: PROJECT_IMAGE,
    project_timezone: "America/Los_Angeles",
  };

  const profileAvatarByName: Record<string, string> = {
    "Maya Chen": "/demo/avatars/maya-chen.png",
    "Jordan Lee": "/demo/avatars/jordan-lee.png",
    "Avery Patel": "/demo/avatars/avery-patel.png",
    "Priya Shah": "/demo/avatars/priya-shah.png",
  };
  const makeAttendee = (
    scheduleId: string,
    index: number,
    name: string,
    comment = "",
    anonymous = false,
  ): SlotAttendee => {
    const username = name.toLowerCase().replace(/[^a-z0-9]+/g, ".");

    return {
      signup_id: `demo-${scheduleId}-${index}`,
      schedule_id: scheduleId,
      user_id: anonymous ? null : `demo-user-${username}`,
      full_name: name,
      username: anonymous ? "" : username,
      avatar_url: anonymous ? "" : (profileAvatarByName[name] ?? ""),
      volunteer_comment: comment,
      is_anonymous: anonymous,
      anonymous_name: anonymous ? name : "",
      profile_note: anonymous
        ? undefined
        : index % 3 === 0
          ? "Verified volunteer with recent project check-ins."
          : index % 3 === 1
            ? "Student volunteer tracking service hours."
            : "Community member helping with local cleanup projects.",
      is_trusted: !anonymous && index % 4 === 0,
      created_at: "2025-01-15T00:00:00.000Z",
    };
  };

  const attendeeGroups = [
    {
      scheduleId: `${dayOne}-0-0`,
      rows: [
        ["Maya Chen", "Bringing gloves and trash bags."],
        ["Jordan Lee", "Can help sort recycling."],
        ["Avery Patel", ""],
        ["Nina Brooks", "Happy to cover shoreline photos."],
        ["Sam Rivera", ""],
        ["Priya Shah", "Joining with two friends."],
        ["Ethan Wong", ""],
        ["Lena Kim", "Can stay 15 minutes late."],
        ["Marcus Reed", ""],
        ["Anonymous Volunteer", "Prefers supply sorting.", true],
        ["Anonymous Volunteer", "", true],
      ],
    },
    {
      scheduleId: `${dayOne}-0-1`,
      rows: [
        ["Grace Lin", "I can check people in."],
        ["Owen Clark", ""],
        ["Anonymous Volunteer", "Bringing extra water.", true],
      ],
    },
    {
      scheduleId: `${dayTwo}-1-0`,
      rows: [
        ["Sofia Martinez", ""],
        ["Noah Singh", "Can help carry full bags."],
        ["Isabella Nguyen", ""],
        ["Lucas Brown", ""],
        ["Amara Davis", "I have a grabber tool."],
        ["Ben Carter", ""],
        ["Mila Johnson", "Can lead a small group."],
        ["Kai Thompson", ""],
        ["Emma Wilson", ""],
        ["Daniel Park", "Bringing reusable gloves."],
        ["Leah Robinson", ""],
        ["Ravi Mehta", ""],
        ["Anonymous Volunteer", "Coming with family.", true],
        ["Anonymous Volunteer", "", true],
        ["Anonymous Volunteer", "Can help with photos.", true],
        ["Anonymous Volunteer", "", true],
      ],
    },
    {
      scheduleId: `${dayTwo}-1-1`,
      rows: [
        ["Chloe Adams", "Experienced with sorting."],
        ["Henry Scott", ""],
        ["Zara Ali", "Can label bins."],
        ["Anonymous Volunteer", "", true],
        ["Anonymous Volunteer", "Can stay until 5:30.", true],
      ],
    },
  ] satisfies Array<{
    scheduleId: string;
    rows: Array<[string, string?, boolean?]>;
  }>;

  const attendees: SlotAttendee[] = attendeeGroups.flatMap((group) =>
    group.rows.map(([name, comment = "", anonymous = false], index) =>
      makeAttendee(group.scheduleId, index, name, comment, anonymous),
    ),
  );

  return { project, creator, organization, attendees };
}

function RealProjectDemoWindow() {
  const [demoScrollEnabled, setDemoScrollEnabled] = useState(false);
  const demoWindowRef = useRef<HTMLDivElement>(null);
  const { project, creator, organization, attendees } = useMemo(
    buildDemoProject,
    [],
  );
  const remainingSlots = useMemo(
    () => ({
      [`${project.schedule.multiDay?.[0]?.date}-0-0`]: 14,
      [`${project.schedule.multiDay?.[0]?.date}-0-1`]: 5,
      [`${project.schedule.multiDay?.[1]?.date}-1-0`]: 9,
      [`${project.schedule.multiDay?.[1]?.date}-1-1`]: 7,
    }),
    [project.schedule.multiDay],
  );

  useEffect(() => {
    if (!demoScrollEnabled) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!demoWindowRef.current?.contains(event.target as Node)) {
        setDemoScrollEnabled(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [demoScrollEnabled]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto w-full max-w-6xl"
      id="live-demo"
    >
      <div
        ref={demoWindowRef}
        className="relative overflow-hidden rounded-[1.75rem] border border-primary/25 bg-background shadow-2xl shadow-primary/10 ring-1 ring-primary/15"
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("[data-demo-scroll-toggle]")) {
            return;
          }
          setDemoScrollEnabled(true);
        }}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b bg-muted/30 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2" aria-hidden>
            <span className="size-2.5 rounded-full bg-destructive/70" />
            <span className="size-2.5 rounded-full bg-warning/70" />
            <span className="size-2.5 rounded-full bg-success/70" />
          </div>
          <div className="min-w-0 text-center">
            <p className="max-w-[58vw] truncate rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs sm:max-w-none sm:px-4">
              {PROJECT_DISPLAY_URL}
            </p>
          </div>
          <div aria-hidden />
        </div>
        <div
          className={cn(
            "max-h-[78svh] overflow-hidden md:max-h-[720px] lg:max-h-[760px]",
            demoScrollEnabled && "md:overflow-y-auto md:overscroll-contain",
            demoScrollEnabled && "la-demo-scroll-region",
          )}
          data-lenis-prevent={demoScrollEnabled ? true : undefined}
        >
          <ProjectDetails
            project={project}
            creator={creator}
            organization={organization}
            initialSlotData={{
              remainingSlots,
              userSignups: {},
              rejectedSlots: {},
              attendedSlots: {},
              pendingSlots: {},
            }}
            initialIsCreator={false}
            initialCanManageProject={false}
            initialUser={null}
            userSignupsData={[]}
            allSignups={[]}
            demoMode
            demoPublicAttendees={attendees}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={demoScrollEnabled}
          onClick={() => setDemoScrollEnabled((enabled) => !enabled)}
          data-demo-scroll-toggle
          className="absolute bottom-14 right-3 z-30 hidden h-8 rounded-full bg-background/90 px-3 text-xs font-medium shadow-md backdrop-blur md:inline-flex"
        >
          {demoScrollEnabled
            ? "Demo scroll on"
            : "Click here to scroll on this demo"}
        </Button>
      </div>
      <div className="pointer-events-none relative z-20 mx-auto -mt-4 h-48 max-w-6xl sm:-mt-10 sm:h-44">
        <svg
          aria-hidden
          viewBox="0 0 118 150"
          className="absolute right-0 top-2 h-28 w-24 text-foreground sm:-right-1 sm:top-0 sm:h-36 sm:w-32"
          fill="none"
        >
          <path
            d="M93 133C121 93 85 36 24 15"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M88 129C113 91 82 40 28 18"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.45"
          />
          <path
            d="M24 15C34 26 41 37 47 50"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M24 15C40 14 54 16 67 22"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="absolute bottom-2 left-1/2 m-0 -translate-x-1/2 text-balance text-center text-sm font-medium text-foreground sm:bottom-0 sm:left-auto sm:right-0 sm:translate-x-0 sm:text-base">
          try our interactive demo
        </p>
      </div>
    </motion.div>
  );
}

export const HeroContent = () => {
  const [awardDialogOpen, setAwardDialogOpen] = useState(false);

  return (
    <section className="container relative isolate mx-auto w-full px-4 pb-12 pt-10 sm:px-6 md:pb-16 md:pt-16">
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <Dialog open={awardDialogOpen} onOpenChange={setAwardDialogOpen}>
          <DialogTrigger
            render={
              <button
                type="button"
                className="group flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Image
                  src="/logos/congressional-app-challenge-cropped.svg"
                  alt=""
                  width={24}
                  height={16}
                  className="h-4 w-auto object-contain transition-transform duration-300 group-hover:scale-105"
                  style={{
                    filter:
                      "drop-shadow(0 0 0.65px rgba(255,255,255,0.95)) drop-shadow(0 0 1.25px rgba(255,255,255,0.7))",
                  }}
                />
                Awarded Special Recognition at 2025 Congressional App Challenge
              </button>
            }
          />
          <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto p-0 sm:max-w-3xl">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-lg bg-muted">
              <Image
                src="/images/congressional-recognition-certificate.jpeg"
                alt="Certificate of Special Congressional Recognition for the 2025 Congressional App Challenge"
                fill
                sizes="(min-width: 768px) 720px, 95vw"
                className="object-cover"
              />
            </div>
            <DialogHeader className="px-6 pb-6 text-left">
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                Congressional recognition
              </DialogTitle>
              <DialogDescription className="text-sm leading-6">
                Let&apos;s Assist received a Certificate of Special
                Congressional Recognition from Congressman Mark DeSaulnier for
                the 2025 Congressional App Challenge. The recognition was
                presented to Riddhiman Rana for building software that helps
                communities coordinate volunteering, signups, and service
                records.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>

        <h1 className="mt-5 max-w-5xl text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground sm:text-6xl sm:leading-[0.98] md:text-[5rem]">
          <AnimatedText
            text="The modern way to do"
            mode="letters"
            className="justify-center"
            delay={0.04}
          />
          <AnimatedText
            text="volunteering"
            mode="letters"
            className="justify-center text-primary"
            delay={0.46}
          />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.78, duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-4 max-w-xl text-[0.95rem] leading-6.5 text-muted-foreground sm:mt-5 sm:max-w-2xl sm:text-lg sm:leading-8"
        >
          One link for public signups, QR attendance, verified hours,
          certificates, and organization workflows that scale from student clubs
          to citywide volunteer programs.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.95, duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 flex w-full max-w-[560px] flex-col items-center justify-center gap-3 sm:mt-7 sm:w-auto sm:max-w-none sm:flex-row"
        >
          <MotionLinkButton href="/signup">
            Get started
            <ArrowRight data-icon="inline-end" />
          </MotionLinkButton>
          <MotionLinkButton href="/contact" tone="outline">
            Contact us
          </MotionLinkButton>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: 1.12, duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="mt-10"
      >
        <RealProjectDemoWindow />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.28, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-6 grid w-full max-w-6xl gap-3 sm:grid-cols-3"
      >
        {platformHighlights.map((item) => (
          <Card key={item.title} className="bg-card/80 shadow-xs backdrop-blur">
            <CardContent className="p-4">
              <div className="mb-4 flex h-10 items-center">
                {item.logos ? (
                  <div className="flex items-center gap-2">
                    {item.logos.map((logo) => (
                      <span
                        key={logo.src}
                        className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs"
                      >
                        <Image
                          src={logo.src}
                          alt={logo.alt}
                          width={24}
                          height={24}
                          className="size-6 object-contain"
                        />
                      </span>
                    ))}
                  </div>
                ) : item.icon ? (
                  <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <item.icon className="size-5" />
                  </div>
                ) : null}
              </div>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {item.desc}
              </p>
            </CardContent>
          </Card>
        ))}
      </motion.div>
    </section>
  );
};
