import { describe, expect, mock, test } from "bun:test";

let sanitizeCalls = 0;

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (v: string) => {
    sanitizeCalls += 1;
    return v;
  },
}));
mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async () => undefined,
}));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => ({ get: () => undefined }),
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runProjectCreate: async () => undefined,
  runProjectClone: async () => undefined,
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/lib/plugins/access-role", () => ({
  toOrganizationPluginAccessRole: () => null,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({ upsert: async () => ({ error: null }) }),
  }),
}));

/**
 * Behavioral: updateProject validates only AFTER authentication and
 * authorization. An unauthenticated caller with an invalid timezone or
 * recurrence rule must receive "Unauthorized", not a validation error.
 */

describe("updateProject — auth/authz precedes validation", () => {
  test("unauthenticated input is not sanitized", async () => {
    mock.module("@/lib/supabase/auth-helpers", () => ({
      getAuthUser: async () => ({ user: null, error: new Error("no session") }),
    }));
    mock.module("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: () => ({}) }),
    }));

    const { updateProject } =
      await import("@/app/projects/[id]/server/lifecycle");
    const callsBefore = sanitizeCalls;

    const result = await updateProject("proj-1", {
      description: "<p>untrusted</p>",
    });

    expect(result).toEqual({ error: "Unauthorized" });
    expect(sanitizeCalls).toBe(callsBefore);
  });

  test("unauthenticated caller with invalid timezone gets Unauthorized, not a validation error", async () => {
    mock.module("@/lib/supabase/auth-helpers", () => ({
      getAuthUser: async () => ({ user: null, error: new Error("no session") }),
    }));
    mock.module("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ single: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    }));

    const { updateProject } =
      await import("@/app/projects/[id]/server/lifecycle");

    const result = await updateProject("proj-1", {
      project_timezone: "Not/A/Real/Timezone",
    });

    expect(result).toEqual({ error: "Unauthorized" });
  });

  test("unauthenticated caller with corrupt recurrence rule gets Unauthorized, not a validation error", async () => {
    mock.module("@/lib/supabase/auth-helpers", () => ({
      getAuthUser: async () => ({ user: null, error: new Error("no session") }),
    }));
    mock.module("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ single: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    }));

    const { updateProject } =
      await import("@/app/projects/[id]/server/lifecycle");

    const result = await updateProject("proj-1", {
      recurrence_rule: {
        frequency: "daily",
        interval: -999,
        end_type: "never",
      } as never,
    });

    expect(result).toEqual({ error: "Unauthorized" });
  });

  test("explicit undefined project_timezone is treated as omitted, not validated", async () => {
    const USER_ID = "user-auth-1";
    mock.module("@/lib/supabase/auth-helpers", () => ({
      getAuthUser: async () => ({
        user: { id: USER_ID },
        error: null,
      }),
    }));

    let updateCalled = false;
    mock.module("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  creator_id: USER_ID,
                  organization_id: null,
                  can_be_managed_by_staff: false,
                  recurrence_parent_id: null,
                  recurrence_rule: null,
                  visibility: "unlisted",
                },
                error: null,
              }),
            }),
          }),
          update: (_vals: unknown) => {
            updateCalled = true;
            return {
              eq: () => ({ error: null }),
            };
          },
        }),
      }),
    }));

    const { updateProject } =
      await import("@/app/projects/[id]/server/lifecycle");

    // Explicit undefined should be treated as omitted — no timezone error.
    const result = await updateProject("proj-1", {
      project_timezone: undefined,
      title: "Updated Title",
    });

    expect(result.error).toBeUndefined();
    expect(updateCalled).toBe(true);
  });
});
