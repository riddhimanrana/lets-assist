import type { Organization, Project, Signup } from "@/types";
import type { AuthUser } from "@/lib/supabase/types";
import type { ProjectCreatorProfileRecord } from "@/lib/profile/public";
import type { SlotAttendee } from "@/components/projects/SlotAttendeesDropdown";

export interface SlotData {
  remainingSlots: Record<string, number>;
  userSignups: Record<string, boolean>;
  rejectedSlots: Record<string, boolean>;
  attendedSlots: Record<string, boolean>;
  pendingSlots: Record<string, boolean>;
}

export interface AnonymousSlotOption {
  scheduleId: string;
  title: string;
  subtitle: string;
}

export const EMPTY_DEMO_ATTENDEES: SlotAttendee[] = [];

export interface ProjectDetailsProps {
  project: Project;
  creator: ProjectCreatorProfileRecord | null;
  organization?: Organization | null;
  initialSlotData: SlotData;
  initialIsCreator: boolean;
  initialCanManageProject: boolean;
  initialUser: AuthUser | null;
  userSignupsData: Signup[];
  allSignups?: Array<
    Pick<Signup, "id" | "schedule_id" | "status" | "check_in_time">
  >;
  demoMode?: boolean;
  demoPublicAttendees?: SlotAttendee[];
}
