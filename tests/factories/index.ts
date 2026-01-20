/**
 * Test data factories for generating mock objects
 * Uses builder pattern for flexible test data creation
 */

import type { Project, ProjectStatus } from "@/types";

// ============================================================================
// User & Profile Factories
// ============================================================================

export interface MockUser {
  id: string;
  email: string;
  email_confirmed_at?: string;
  created_at: string;
  updated_at: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  aud: string;
}

export interface MockProfile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  username: string;
  created_at: string;
  date_of_birth?: string;
  phone?: string;
}

let userCounter = 0;

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  userCounter++;
  const id = overrides.id ?? `user-${userCounter}`;
  
  return {
    id,
    email: `user${userCounter}@test.com`,
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    ...overrides,
  };
}

export function createMockProfile(overrides: Partial<MockProfile> = {}): MockProfile {
  const id = overrides.id ?? `user-${++userCounter}`;
  
  return {
    id,
    full_name: `Test User ${userCounter}`,
    email: `user${userCounter}@test.com`,
    avatar_url: null,
    username: `testuser${userCounter}`,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Project Factories
// ============================================================================

let projectCounter = 0;

export function createMockProject(overrides: Partial<Project> = {}): Project {
  projectCounter++;
  const id = overrides.id ?? `project-${projectCounter}`;
  const creatorId = overrides.creator_id ?? `user-${projectCounter}`;
  
  // Default to a future date for upcoming projects
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  const dateStr = futureDate.toISOString().split("T")[0];
  
  return {
    id,
    title: `Test Project ${projectCounter}`,
    description: `Description for test project ${projectCounter}`,
    location: "123 Test Street",
    event_type: "oneTime",
    verification_method: "manual",
    require_login: false,
    creator_id: creatorId,
    schedule: {
      oneTime: {
        date: dateStr,
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 10,
      },
    },
    status: "upcoming" as ProjectStatus,
    visibility: "public",
    pause_signups: false,
    profiles: {
      full_name: "Project Creator",
      email: "creator@test.com",
      avatar_url: null,
      username: "creator",
      created_at: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockOneTimeProject(overrides: Partial<Project> = {}): Project {
  return createMockProject({
    event_type: "oneTime",
    ...overrides,
  });
}

export function createMockMultiDayProject(overrides: Partial<Project> = {}): Project {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  
  const days = [0, 1, 2].map((offset) => {
    const date = new Date(futureDate);
    date.setDate(date.getDate() + offset);
    return {
      date: date.toISOString().split("T")[0],
      slots: [
        { startTime: "09:00", endTime: "12:00", volunteers: 5 },
        { startTime: "13:00", endTime: "17:00", volunteers: 5 },
      ],
    };
  });
  
  return createMockProject({
    event_type: "multiDay",
    schedule: { multiDay: days },
    ...overrides,
  });
}

export function createMockSameDayMultiAreaProject(overrides: Partial<Project> = {}): Project {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  const dateStr = futureDate.toISOString().split("T")[0];
  
  return createMockProject({
    event_type: "sameDayMultiArea",
    schedule: {
      sameDayMultiArea: {
        date: dateStr,
        overallStart: "08:00",
        overallEnd: "18:00",
        roles: [
          { name: "Registration", startTime: "08:00", endTime: "10:00", volunteers: 3 },
          { name: "Setup", startTime: "08:00", endTime: "09:00", volunteers: 5 },
          { name: "Food Service", startTime: "11:00", endTime: "14:00", volunteers: 8 },
          { name: "Cleanup", startTime: "17:00", endTime: "18:00", volunteers: 4 },
        ],
      },
    },
    ...overrides,
  });
}

export function createCompletedProject(overrides: Partial<Project> = {}): Project {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 7);
  const dateStr = pastDate.toISOString().split("T")[0];
  
  return createMockProject({
    status: "completed" as ProjectStatus,
    schedule: {
      oneTime: {
        date: dateStr,
        startTime: "09:00",
        endTime: "12:00",
        volunteers: 10,
      },
    },
    ...overrides,
  });
}

export function createCancelledProject(overrides: Partial<Project> = {}): Project {
  return createMockProject({
    status: "cancelled" as ProjectStatus,
    cancellation_reason: "Event cancelled due to weather",
    cancelled_at: new Date().toISOString(),
    ...overrides,
  });
}

// ============================================================================
// Organization Factories
// ============================================================================

export interface MockOrganization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  website: string | null;
  created_at: string;
  is_verified: boolean;
}

export interface MockOrganizationMember {
  organization_id: string;
  user_id: string;
  role: "admin" | "staff" | "member";
  joined_at: string;
}

let orgCounter = 0;

export function createMockOrganization(overrides: Partial<MockOrganization> = {}): MockOrganization {
  orgCounter++;
  
  return {
    id: `org-${orgCounter}`,
    name: `Test Organization ${orgCounter}`,
    slug: `test-org-${orgCounter}`,
    description: `Description for test organization ${orgCounter}`,
    logo_url: null,
    website: null,
    created_at: new Date().toISOString(),
    is_verified: false,
    ...overrides,
  };
}

export function createMockOrgMember(overrides: Partial<MockOrganizationMember> = {}): MockOrganizationMember {
  return {
    organization_id: `org-${orgCounter}`,
    user_id: `user-${userCounter}`,
    role: "member",
    joined_at: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Signup Factories
// ============================================================================

export interface MockSignup {
  id: string;
  project_id: string;
  user_id: string | null;
  schedule_id: string;
  status: "pending" | "approved" | "attended" | "rejected" | "cancelled";
  created_at: string;
  full_name: string;
  email: string;
}

let signupCounter = 0;

export function createMockSignup(overrides: Partial<MockSignup> = {}): MockSignup {
  signupCounter++;
  
  return {
    id: `signup-${signupCounter}`,
    project_id: `project-${projectCounter}`,
    user_id: `user-${userCounter}`,
    schedule_id: "oneTime",
    status: "approved",
    created_at: new Date().toISOString(),
    full_name: `Volunteer ${signupCounter}`,
    email: `volunteer${signupCounter}@test.com`,
    ...overrides,
  };
}

// ============================================================================
// Notification Factories
// ============================================================================

export interface MockNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: "email_notifications" | "project_updates" | "general";
  severity: "info" | "warning" | "success";
  action_url: string | null;
  data: Record<string, unknown> | null;
  displayed: boolean;
  read: boolean;
  created_at: string;
}

let notificationCounter = 0;

export function createMockNotification(overrides: Partial<MockNotification> = {}): MockNotification {
  notificationCounter++;
  
  return {
    id: `notification-${notificationCounter}`,
    user_id: `user-${userCounter}`,
    title: `Test Notification ${notificationCounter}`,
    body: `This is test notification body ${notificationCounter}`,
    type: "general",
    severity: "info",
    action_url: null,
    data: null,
    displayed: false,
    read: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Supabase Mock Helpers
// ============================================================================

export interface MockSupabaseResponse<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export function mockSupabaseSuccess<T>(data: T): MockSupabaseResponse<T> {
  return { data, error: null };
}

export function mockSupabaseError(message: string, code?: string): MockSupabaseResponse<null> {
  return { data: null, error: { message, code } };
}

/**
 * Creates a chainable Supabase query builder mock
 */
export function createMockQueryBuilder<T>(finalResult: MockSupabaseResponse<T>) {
  const builder: Record<string, unknown> = {};
  
  const methods = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gt", "gte", "lt", "lte",
    "like", "ilike", "is", "in", "contains",
    "filter", "match", "not", "or", "and",
    "order", "limit", "range", "offset",
    "maybeSingle", "single", "count",
  ];
  
  methods.forEach((method) => {
    if (method === "single" || method === "maybeSingle") {
      builder[method] = () => Promise.resolve(finalResult);
    } else {
      builder[method] = () => builder;
    }
  });
  
  // Make the builder thenable for direct await
  builder.then = (resolve: (value: MockSupabaseResponse<T>) => void) => {
    resolve(finalResult);
    return builder;
  };
  
  return builder;
}

/**
 * Reset all counters - call in beforeEach for clean test isolation
 */
export function resetFactories(): void {
  userCounter = 0;
  projectCounter = 0;
  orgCounter = 0;
  signupCounter = 0;
  notificationCounter = 0;
}
