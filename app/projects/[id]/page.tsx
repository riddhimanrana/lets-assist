import { createClient } from "@/lib/supabase/server";
import { getProject, getCreatorProfile } from "./actions";
import { notFound } from "next/navigation";
import { getSlotCapacities } from "@/utils/project";
import ProjectUnauthorized from "./ProjectUnauthorized";
import { Signup } from "@/types";
import VolunteerStatusCard from "@/app/projects/_components/VolunteerStatusCard";
import ProjectClient from "./ProjectClient";
import { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { project } = await getProject(id);
  const title = project ? project.title : "Project";
  const description = project
    ? `Volunteer for ${project.title}${project.location ? ` in ${project.location}` : ""}. ${project.description?.substring(0, 100) || ""}`
    : "View and manage project details.";
  const baseUrl = new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://lets-assist.com",
  );
  const projectUrl = new URL(`/projects/${id}`, baseUrl);
  const ogImageUrl = new URL(`/projects/${id}/opengraph-image`, baseUrl);

  return {
    title,
    description,
    metadataBase: baseUrl,
    alternates: {
      canonical: projectUrl,
    },
    keywords: project
      ? [
          "volunteer",
          "volunteering",
          project.title,
          project.location || "remote",
          "community service",
          project.organization?.name || "",
        ]
      : [],
    openGraph: {
      title,
      description,
      type: "article",
      url: projectUrl,
      siteName: "Let's Assist",
      publishedTime: project?.created_at,
      authors: project?.organization?.name
        ? [project.organization.name]
        : undefined,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${title} — Let's Assist`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkedIn?: string; schedule?: string }>; // expects checkedIn and schedule flags
}

type ApprovedSignupRow = {
  id: string;
  schedule_id: string;
  status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  created_at: string;
};

type RejectionRow = {
  schedule_id: string;
};

export default async function ProjectPage({
  params,
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const supabase = await createClient();

  // Destructure id from params
  const { id } = await params;
  const { checkedIn, schedule } = await searchParams;

  // Get the project data
  const { project, error: projectError } = await getProject(id);

  // Handle unauthorized access to private projects
  if (projectError === "unauthorized") {
    return <ProjectUnauthorized projectId={id} />;
  }

  // Handle project not found
  if (projectError || !project) {
    notFound();
  }

  const { profile: creator, error: profileError } = await getCreatorProfile(
    project.creator_id,
  );
  if (profileError) {
    console.error("Error fetching creator profile:", profileError);
  }
  if (!creator) {
    notFound();
  }

  // Check if current user is the project creator
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isCreator = user?.id === project.creator_id;

  // If redirected after check-in, render the status card
  if (checkedIn === "true" && schedule && user) {
    const { data: signup } = await supabase
      .from("project_signups")
      .select("check_in_time, schedule_id")
      .eq("project_id", project.id)
      .eq("user_id", user.id)
      .eq("schedule_id", schedule)
      .single();
    if (signup && signup.check_in_time) {
      // Pass the full signup object
      return (
        <VolunteerStatusCard project={project} signup={signup as Signup} />
      );
    }
  }

  // Get organization if exists
  let organization = null;
  if (project.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", project.organization_id)
      .single();
    organization = org;
  }

  // Get remaining slots for each schedule
  // Pass supabase client and project id to the updated function
  const slotCapacities = await getSlotCapacities(project, supabase, id);

  // Get user's existing signups (approved and checked-in)
  const userSignups: Record<string, boolean> = {};
  const attendedSlots: Record<string, boolean> = {};
  // Fetch full signup data for the UserDashboard
  let userSignupsData: Signup[] = [];
  if (user) {
    // Fetch approved signups first
    const { data: approvedSignups, error: approvedError } = (await supabase
      .from("project_signups")
      // Select all necessary fields for UserDashboard
      .select(
        "id, schedule_id, status, check_in_time, check_out_time, created_at",
      )
      .eq("project_id", project.id)
      .eq("user_id", user.id)
      .in("status", ["approved", "attended"])) as {
      data: ApprovedSignupRow[] | null;
      error: { message: string } | null;
    }; // Fetch both approved and attended signups

    if (approvedError) {
      console.error("Error fetching user approved signups:", approvedError);
    } else if (approvedSignups) {
      userSignupsData = approvedSignups as Signup[]; // Store full data
      approvedSignups.forEach(
        (signup: { schedule_id: string; check_in_time: string | null }) => {
          userSignups[signup.schedule_id] = true; // Keep this for the signup button logic
          if (signup.check_in_time) {
            attendedSlots[signup.schedule_id] = true; // Mark attended slots
          }
        },
      );
    }
  }

  // Get user's rejected slots
  const rejectedSlots: Record<string, boolean> = {};
  if (user) {
    const { data: rejections } = (await supabase
      .from("project_signups")
      .select("schedule_id")
      .eq("project_id", project.id)
      .eq("user_id", user.id)
      .eq("status", "rejected")) as {
      data: RejectionRow[] | null;
      error: { message: string } | null;
    };

    if (rejections) {
      rejections.forEach((rejection: { schedule_id: string }) => {
        rejectedSlots[rejection.schedule_id] = true;
      });
    }
  }

  // Format initial data for the client component
  const initialSlotData = {
    remainingSlots: slotCapacities,
    userSignups: userSignups, // Boolean map for button state
    rejectedSlots: rejectedSlots,
    attendedSlots: attendedSlots, // Add attendedSlots to initial data
  };

  // Render the Client Component, passing all necessary data as props
  return (
    <ProjectClient
      project={project}
      creator={creator}
      organization={organization}
      initialSlotData={initialSlotData}
      initialIsCreator={isCreator}
      initialUser={user}
      // Pass the full signup data
      userSignupsData={userSignupsData}
    />
  );
}
