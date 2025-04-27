"use client";

import ProjectDetails from './ProjectDetails';
// Import Signup type along with others if needed
import { Project, Profile, Organization, Signup } from '@/types'; 
import { User } from '@supabase/supabase-js';

// Define Props interface
interface Props {
  project: Project;
  // Use specific types if available
  creator: Profile | null; 
  organization: Organization | null;
  initialSlotData: {
    remainingSlots: Record<string, number>;
    userSignups: Record<string, boolean>;
    rejectedSlots: Record<string, boolean>;
    attendedSlots: Record<string, boolean>; // Add the missing attendedSlots property
  };
  initialIsCreator: boolean;
  initialUser: User | null;
  // Add prop for full signup data
  userSignupsData: Signup[]; 
}

export default function ProjectClient({
  project,
  creator,
  organization,
  initialSlotData,
  initialIsCreator,
  initialUser,
  // Destructure the new prop
  userSignupsData, 
}: Props) {
  return (
    <ProjectDetails
      project={project}
      creator={creator}
      organization={organization}
      initialSlotData={initialSlotData}
      initialIsCreator={initialIsCreator}
      initialUser={initialUser}
      // Pass the signup data down
      userSignupsData={userSignupsData} 
    />
  );
}
