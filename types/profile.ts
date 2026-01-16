// Profile-related types
import type { ProfileVisibility } from './common';

export interface VolunteerGoalsData {
  hours_goal: number;
  events_goal: number;
}

export interface Profile {
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  username: string | null;
  created_at: string | null;
  volunteer_goals?: VolunteerGoalsData | null;
  profile_visibility?: ProfileVisibility | null;
  organization_id?: string | null;
}
