import { Project as BaseProject, ProjectSignup as BaseProjectSignup, SignupStatus } from '@/types';

// Extend the Project type to include cover_image_url and documents
declare module '@/types' {
  interface ProjectDocument {
    name: string;
    originalName: string;
    type: string;
    size: number;
    url: string;
  }

  interface Project extends BaseProject {
    cover_image_url?: string;
    documents?: ProjectDocument[];
  }

  // Define the structure for the anonymous_signups table
  interface AnonymousSignup {
    id: string; // UUID
    created_at: string; // TIMESTAMPTZ
    token: string; // UUID
    project_id: string; // UUID, FK to projects.id
    signup_id: string; // UUID, FK to project_signups.id
    email: string;
    name: string;
    phone_number?: string | null;
    confirmed_at?: string | null; // TIMESTAMPTZ
  }

  // Define or extend ProjectSignup type
  interface ProjectSignup extends BaseProjectSignup {
    id: string;
    created_at: string;
    project_id: string;
    schedule_id: string;
    user_id?: string | null; // FK to profiles.id
    status: SignupStatus;
    anonymous_id?: string | null; // FK to anonymous_signups.id
  }
}
