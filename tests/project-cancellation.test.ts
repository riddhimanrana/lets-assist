import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/types";
import { updateProjectStatus } from "@/app/projects/[id]/actions";

let mockSupabase: any;
let serviceRoleMock: any;
let lastUpdateData: Record<string, unknown> | undefined;
let upsertResult: { error: { message?: string } | null } = { error: null };

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock("@/utils/supabase/service-role", () => ({
  getServiceRoleClient: () => serviceRoleMock,
}));

vi.mock("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const baseProject: Project = {
  id: "project-1",
  title: "Community Cleanup",
  description: "Test project",
  location: "Main Street",
  event_type: "oneTime",
  verification_method: "manual",
  require_login: false,
  creator_id: "user-1",
  schedule: {
    oneTime: {
      date: "2030-01-01",
      startTime: "09:00",
      endTime: "10:00",
      volunteers: 5,
    },
  },
  status: "upcoming",
  visibility: "public",
  pause_signups: false,
  profiles: {
    full_name: "Creator",
    email: "creator@example.com",
    avatar_url: null,
    username: "creator",
    created_at: new Date().toISOString(),
  },
  created_at: new Date().toISOString(),
};

const createSupabaseMock = (project: Project) => {
  lastUpdateData = undefined;

  const from = vi.fn((table: string) => {
    let mode: "select" | "update" | null = null;
    const builder: any = {
      select: vi.fn(() => {
        mode = "select";
        return builder;
      }),
      update: vi.fn((data: Record<string, unknown>) => {
        mode = "update";
        lastUpdateData = data;
        return builder;
      }),
      eq: vi.fn(() => {
        if (mode === "update") {
          return Promise.resolve({ data: null, error: null });
        }
        return builder;
      }),
      single: vi.fn(async () => {
        if (table === "projects") {
          return { data: project, error: null };
        }
        if (table === "organization_members") {
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }),
    };

    return builder;
  });

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: project.creator_id } },
        error: null,
      })),
    },
    from,
  };
};

beforeEach(() => {
  mockSupabase = createSupabaseMock({ ...baseProject });
  upsertResult = { error: null };

  // Service role mock that properly chains method calls
  serviceRoleMock = {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve(upsertResult)),
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  };

  // Mock fetch for the worker trigger
  global.fetch = vi.fn(() => 
    Promise.resolve({ ok: true } as Response)
  );

  process.env.PROJECT_CANCELLATION_WORKER_ENABLED = "true";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN = "test-worker-token";
});

describe("updateProjectStatus cancellation flow", () => {
  it("queues cancellation notifications and attempts to trigger worker", async () => {
    const result = await updateProjectStatus("project-1", "cancelled", "Weather" );

    expect(result.success).toBe(true);
    expect(result.cancellationNotifications?.enqueued).toBe(true);
    expect(result.cancellationNotifications?.triggerAttempted).toBe(true);
    expect(result.cancellationNotifications?.error).toBeUndefined();

    expect(lastUpdateData?.status).toBe("cancelled");
    expect(lastUpdateData?.cancellation_reason).toBe("Weather");
    expect(lastUpdateData?.cancelled_at).toBeDefined();
  });

  it("returns a warning when notifications cannot be enqueued", async () => {
    upsertResult = { error: { message: "db down" } };

    const result = await updateProjectStatus("project-1", "cancelled", "Venue issue" );

    expect(result.success).toBe(true);
    expect(result.cancellationNotifications?.enqueued).toBe(false);
    expect(result.cancellationNotifications?.error).toBe(
      "Failed to queue cancellation notifications."
    );
  });
});
