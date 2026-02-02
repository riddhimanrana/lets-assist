// Organization-related types

export interface Organization {
  id: string;
  name: string;
  username: string;
  description?: string;
  logo_url?: string;
  type: string;
  verified: boolean;
  allowed_email_domains?: string[] | null;
}
