import { describe, expect, mock, test } from "bun:test";

let sanitizeCalls = 0;

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => {
    sanitizeCalls += 1;
    return value;
  },
}));
mock.module("@/lib/projects/waiver-validation", () => ({
  getWaiverPdfRequirementError: () => null,
  getWaiverConfigurationError: () => null,
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: new Error("no session"),
      }),
    },
  }),
}));

const {
  autoSaveDraft,
  createProject,
  saveProjectAsDraft,
  saveProjectAsNewDraft,
} = await import("@/app/projects/create/server/drafts");

describe("draft writers authenticate before inspecting input", () => {
  test("autosave does not sanitize unauthenticated draft data", async () => {
    const callsBefore = sanitizeCalls;
    const result = await autoSaveDraft({
      basicInfo: {
        title: "Untrusted",
        description: "<p>untrusted</p>",
        location: "Somewhere",
        organizationId: null,
        projectTimezone: "UTC",
      },
    });

    expect(result).toEqual({
      error: "You must be logged in to autosave a draft",
      autosaved: false,
    });
    expect(sanitizeCalls).toBe(callsBefore);
  });

  test("form draft writers do not read or parse unauthenticated form data", async () => {
    let formReads = 0;
    const untrustedForm = {
      get: () => {
        formReads += 1;
        throw new Error("form data must not be read");
      },
    } as unknown as FormData;

    expect(await saveProjectAsDraft(untrustedForm)).toEqual({
      error: "You must be logged in to save a draft",
    });
    expect(await saveProjectAsNewDraft(untrustedForm)).toEqual({
      error: "You must be logged in to save a draft",
    });
    expect(await createProject(untrustedForm)).toEqual({
      error: "You must be logged in to create a project",
    });
    expect(formReads).toBe(0);
  });
});
