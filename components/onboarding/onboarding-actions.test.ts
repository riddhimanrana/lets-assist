import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  checkOffensiveLanguage: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  refreshSession: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  selectEq: vi.fn(),
  maybeSingle: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/utils/moderation-helpers", () => ({
  checkOffensiveLanguage: mocks.checkOffensiveLanguage,
}));

import { completeInitialOnboarding, markIntroTourAsComplete } from "./onboarding-actions";

function buildSupabaseClientMock() {
  return {
    auth: {
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      refreshSession: mocks.refreshSession,
    },
    from: mocks.from,
  };
}

describe("onboarding actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.checkOffensiveLanguage.mockResolvedValue({
      isProfane: false,
    });

    mocks.selectEq.mockReturnValue({
      maybeSingle: mocks.maybeSingle,
    });
    mocks.select.mockReturnValue({
      eq: mocks.selectEq,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    mocks.update.mockReturnValue({
      eq: mocks.updateEq,
    });
    mocks.updateEq.mockResolvedValue({
      error: null,
    });

    mocks.from.mockReturnValue({
      select: mocks.select,
      update: mocks.update,
    });

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          user_metadata: {},
        },
      },
    });

    mocks.updateUser.mockResolvedValue({
      error: null,
    });

    mocks.refreshSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });

    mocks.createClient.mockResolvedValue(buildSupabaseClientMock());
  });

  it("merges existing metadata and refreshes session after initial onboarding", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          user_metadata: {
            has_completed_intro_tour: true,
            auto_joined_org_name: "Acme Helpers",
          },
        },
      },
    });

    const result = await completeInitialOnboarding("FreshVolunteer", "5551234567");

    expect(result).toEqual({ success: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: {
        has_completed_intro_tour: true,
        auto_joined_org_name: "Acme Helpers",
        has_completed_onboarding: true,
        username: "freshvolunteer",
        phone: "5551234567",
      },
    });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("merges existing metadata and refreshes session after the intro tour", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          user_metadata: {
            has_completed_onboarding: true,
            username: "helper-one",
            auto_joined_org_id: "org-1",
          },
        },
      },
    });

    const result = await markIntroTourAsComplete();

    expect(result).toEqual({ success: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: {
        has_completed_onboarding: true,
        username: "helper-one",
        auto_joined_org_id: "org-1",
        has_completed_intro_tour: true,
      },
    });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });
});