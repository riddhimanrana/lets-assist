"use client";

import ProjectDetails from './ProjectDetails';
// Import Signup type along with others if needed
import { Project, Organization, Signup } from '@/types'; 
import { AuthUser } from '@/lib/supabase/types';
import type { ProjectCreatorProfileRecord } from '@/lib/profile/public';

type CreatorDashboardSignupSummary = Pick<
  Signup,
  "id" | "schedule_id" | "status" | "check_in_time"
>;

// Define Props interface
interface Props {
  project: Project;
  // Use specific types if available
  creator: ProjectCreatorProfileRecord | null; 
  organization: Organization | null;
  initialSlotData: {
    remainingSlots: Record<string, number>;
    userSignups: Record<string, boolean>;
    rejectedSlots: Record<string, boolean>;
    attendedSlots: Record<string, boolean>; // Add the missing attendedSlots property
    pendingSlots: Record<string, boolean>;
  };
  initialIsCreator: boolean;
  initialCanManageProject: boolean;
  initialUser: AuthUser | null;
  // Add prop for full signup data
  userSignupsData: Signup[]; 
  allSignups?: CreatorDashboardSignupSummary[];
}

export default function ProjectClient({
  project,
  creator,
  organization,
  initialSlotData,
  initialIsCreator,
  initialCanManageProject,
  initialUser,
  // Destructure the new prop
  userSignupsData, 
  allSignups = [],
}: Props) {
  return (
    <ProjectDetails
      project={project}
      creator={creator}
      organization={organization}
      initialSlotData={initialSlotData}
      initialIsCreator={initialIsCreator}
      initialCanManageProject={initialCanManageProject}
      initialUser={initialUser}
      // Pass the signup data down
      userSignupsData={userSignupsData} 
      allSignups={allSignups}
    />
  );
}
