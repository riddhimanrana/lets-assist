import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/auth/callback/route";
import { getAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
    })),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(),
}));

describe("OAuth callback staff invite handling", () => {
  const mockOrigin = "http://localhost:3000";
  const mockCode = "mock-oauth-code";
  const mockUserId = "user-123";
  const mockOrgId = "org-456";
  const mockToken = "valid-staff-token";
  const mockOrgUsername = "test-org";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should grant staff membership for valid token during OAuth", async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    
    const insertMock = vi.fn(async () => ({ data: null, error: null }));
    
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { 
                    id: mockOrgId, 
                    staff_join_token: mockToken,
                    staff_join_token_expires_at: futureExpiry,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "organization_members") {
          return {
            insert: insertMock,
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const url = `${mockOrigin}/auth/callback?code=${mockCode}&staffToken=${mockToken}&orgUsername=${mockOrgUsername}`;
    const request = new Request(url);

    const response = await GET(request);

    expect(response.status).toBe(307);
    
    // Verify redirects to success path, NOT /error
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}/home`);
    expect(location).not.toContain("/error");
    
    expect(mockAdminClient.from).toHaveBeenCalledWith("organizations");
    expect(mockAdminClient.from).toHaveBeenCalledWith("organization_members");
    
    // Verify insert was called with correct payload including role='staff'
    expect(insertMock).toHaveBeenCalledWith({
      organization_id: mockOrgId,
      user_id: mockUserId,
      role: "staff",
    });
  });

  it("should skip membership for expired token without breaking OAuth flow", async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();
    
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { 
                    id: mockOrgId, 
                    staff_join_token: mockToken,
                    staff_join_token_expires_at: pastExpiry,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const url = `${mockOrigin}/auth/callback?code=${mockCode}&staffToken=${mockToken}&orgUsername=${mockOrgUsername}`;
    const request = new Request(url);

    const response = await GET(request);

    // Should still redirect successfully to /home, NOT /error
    expect(response.status).toBe(307);
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}/home`);
    expect(location).not.toContain("/error");
    
    // Should NOT insert membership for expired token
    const orgMembersCalls = mockAdminClient.from.mock.calls.filter(
      (call) => call[0] === "organization_members"
    );
    expect(orgMembersCalls.length).toBe(0);
  });

  it("should skip membership for token mismatch (org exists, token differs) without breaking OAuth flow", async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    const correctToken = "correct-staff-token";
    const wrongToken = "wrong-token";
    
    const insertMock = vi.fn();
    
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { 
                    id: mockOrgId, 
                    staff_join_token: correctToken, // Correct token stored
                    staff_join_token_expires_at: futureExpiry,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "organization_members") {
          return {
            insert: insertMock,
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    // Pass wrong token in URL
    const url = `${mockOrigin}/auth/callback?code=${mockCode}&staffToken=${wrongToken}&orgUsername=${mockOrgUsername}`;
    const request = new Request(url);

    const response = await GET(request);

    // Should still redirect successfully to /home, NOT /error
    expect(response.status).toBe(307);
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}/home`);
    expect(location).not.toContain("/error");
    
    // Should NOT attempt to insert membership due to token mismatch
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("should skip membership for invalid token without breaking OAuth flow", async () => {
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: null,
                  error: { message: "Not found" },
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const url = `${mockOrigin}/auth/callback?code=${mockCode}&staffToken=wrong-token&orgUsername=${mockOrgUsername}`;
    const request = new Request(url);

    const response = await GET(request);

    // Should still redirect successfully to /home, NOT /error
    expect(response.status).toBe(307);
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}/home`);
    expect(location).not.toContain("/error");
    
    // Should NOT attempt to insert membership
    const orgMembersCalls = mockAdminClient.from.mock.calls.filter(
      (call) => call[0] === "organization_members"
    );
    expect(orgMembersCalls.length).toBe(0);
  });

  it("should handle duplicate membership (23505) by upgrading role from member to staff", async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    
    const selectMock = vi.fn(async () => ({ 
      data: { role: "member" }, // Existing member
      error: null,
    }));
    const updateMock = vi.fn(async () => ({ data: null, error: null }));
    const firstEqMock = vi.fn(() => ({
      eq: vi.fn((field: string, value: string) => {
        // Capture second .eq() call
        expect(field).toBe("user_id");
        expect(value).toBe(mockUserId);
        return updateMock();
      }),
    }));
    const updateCallMock = vi.fn((payload: { role?: string }) => {
      // Assert update payload contains role: 'staff'
      expect(payload).toEqual({ role: "staff" });
      return {
        eq: vi.fn((field: string, value: string) => {
          // Capture first .eq() call
          expect(field).toBe("organization_id");
          expect(value).toBe(mockOrgId);
          return firstEqMock();
        }),
      };
    });
    
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { 
                    id: mockOrgId, 
                    staff_join_token: mockToken,
                    staff_join_token_expires_at: futureExpiry,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "organization_members") {
          return {
            insert: vi.fn(async () => ({ 
              data: null, 
              error: { code: "23505", message: "duplicate key value" },
            })),
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: selectMock,
                })),
              })),
            })),
            update: updateCallMock,
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const url = `${mockOrigin}/auth/callback?code=${mockCode}&staffToken=${mockToken}&orgUsername=${mockOrgUsername}`;
    const request = new Request(url);

    const response = await GET(request);

    // Should still redirect successfully to /home, NOT /error
    expect(response.status).toBe(307);
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}/home`);
    expect(location).not.toContain("/error");
    
    // Should attempt insert, get duplicate error, query existing role, then update
    expect(mockAdminClient.from).toHaveBeenCalledWith("organization_members");
    expect(selectMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalled();
    // Verify update was called with correct payload and targeting
    expect(updateCallMock).toHaveBeenCalledWith({ role: "staff" });
  });

  it("should NOT downgrade admin to staff on duplicate membership (23505)", async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    
    const selectMock = vi.fn(async () => ({ 
      data: { role: "admin" }, // Existing admin
      error: null,
    }));
    const updateMock = vi.fn(async () => ({ data: null, error: null }));
    
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { 
                    id: mockOrgId, 
                    staff_join_token: mockToken,
                    staff_join_token_expires_at: futureExpiry,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "organization_members") {
          return {
            insert: vi.fn(async () => ({ 
              data: null, 
              error: { code: "23505", message: "duplicate key value" },
            })),
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: selectMock,
                })),
              })),
            })),
            update: vi.fn((_payload: unknown) => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => updateMock()),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const url = `${mockOrigin}/auth/callback?code=${mockCode}&staffToken=${mockToken}&orgUsername=${mockOrgUsername}`;
    const request = new Request(url);

    const response = await GET(request);

    // Should still redirect successfully to /home, NOT /error
    expect(response.status).toBe(307);
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}/home`);
    expect(location).not.toContain("/error");
    
    // Should attempt insert, get duplicate error, query existing role, but NOT update
    expect(mockAdminClient.from).toHaveBeenCalledWith("organization_members");
    expect(selectMock).toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled(); // Critical: should NOT update when admin
  });

  it("should proceed normally when no staff invite params present", async () => {
    const mockAdminClient = {
      from: vi.fn(),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const url = `${mockOrigin}/auth/callback?code=${mockCode}`;
    const request = new Request(url);

    const response = await GET(request);

    // Should redirect successfully to /home, NOT /error
    expect(response.status).toBe(307);
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}/home`);
    expect(location).not.toContain("/error");
    
    // Should NOT call admin client for organizations or members
    expect(mockAdminClient.from).not.toHaveBeenCalled();
  });

  it("should honor redirectAfterAuth when staff invite params are also present (regression test for Phase 2/3)", async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    const customRedirect = "/organization/test-org/dashboard";
    
    const insertMock = vi.fn(async () => ({ data: null, error: null }));
    
    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { 
                    id: mockOrgId, 
                    staff_join_token: mockToken,
                    staff_join_token_expires_at: futureExpiry,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "organization_members") {
          return {
            insert: insertMock,
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

    const { createClient } = await import("@/lib/supabase/server");
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn(async () => ({
          data: {
            session: {
              user: {
                id: mockUserId,
                email: "test@example.com",
                created_at: new Date(Date.now() - 10000).toISOString(),
                user_metadata: {},
                identities: [{ provider: "google" }],
              },
            },
          },
          error: null,
        })),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ 
                  data: { id: mockUserId, full_name: "Test User" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    // URL with BOTH staff invite params AND custom redirectAfterAuth
    const url = `${mockOrigin}/auth/callback?code=${mockCode}&staffToken=${mockToken}&orgUsername=${mockOrgUsername}&redirectAfterAuth=${encodeURIComponent(customRedirect)}`;
    const request = new Request(url);

    const response = await GET(request);

    expect(response.status).toBe(307);
    
    // CRITICAL: Should redirect to custom path, NOT default /home
    const location = response.headers.get("Location");
    expect(location).toBe(`${mockOrigin}${customRedirect}`);
    expect(location).not.toContain("/home");
    expect(location).not.toContain("/error");
    
    // ALSO verify staff membership was still granted
    expect(insertMock).toHaveBeenCalledWith({
      organization_id: mockOrgId,
      user_id: mockUserId,
      role: "staff",
    });
  });
});
