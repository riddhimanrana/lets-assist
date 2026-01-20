/**
 * Tests for email service
 * @see services/email.ts
 * 
 * Note: Since the email service instantiates Resend at module load time,
 * we test the exported function behavior rather than mocking internals.
 * Integration tests with real Resend should be run separately.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// We need to mock at the module level before importing
vi.mock("resend", () => {
  const mockSend = vi.fn().mockResolvedValue({ data: { id: "email-123" }, error: null });
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
    __mockSend: mockSend,
  };
});

vi.mock("@react-email/components", () => ({
  render: vi.fn().mockResolvedValue("<html><body>Rendered</body></html>"),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: "PGRST116" },
          }),
        }),
      }),
    }),
  }),
}));

describe("sendEmail", () => {
  let sendEmail: typeof import("@/services/email").sendEmail;
  let mockSend: ReturnType<typeof vi.fn>;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get the mock send function
    const resendModule = await import("resend");
    mockSend = (resendModule as unknown as { __mockSend: ReturnType<typeof vi.fn> }).__mockSend;
    mockSend.mockResolvedValue({ data: { id: "email-123" }, error: null });
    
    // Reimport to get fresh module
    const emailModule = await import("@/services/email");
    sendEmail = emailModule.sendEmail;
  });
  
  describe("validation", () => {
    it("fails if neither html nor react is provided", async () => {
      const result = await sendEmail({
        to: "test@example.com",
        subject: "Test",
        type: "general",
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe("Either html or react must be provided");
    });
  });
  
  describe("sending emails", () => {
    it("sends email with HTML content", async () => {
      const result = await sendEmail({
        to: "recipient@example.com",
        subject: "Test Subject",
        html: "<p>Hello World</p>",
        type: "general",
      });
      
      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith({
        from: "Let's Assist <projects@notifications.lets-assist.com>",
        to: "recipient@example.com",
        subject: "Test Subject",
        html: "<p>Hello World</p>",
      });
    });
    
    it("handles multiple recipients", async () => {
      await sendEmail({
        to: ["user1@example.com", "user2@example.com"],
        subject: "Batch Email",
        html: "<p>Hello</p>",
        type: "general",
      });
      
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["user1@example.com", "user2@example.com"],
        })
      );
    });
  });
  
  describe("error handling", () => {
    it("handles Resend API errors", async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: "Rate limit exceeded" },
      });
      
      const result = await sendEmail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        type: "general",
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toEqual({ message: "Rate limit exceeded" });
    });
    
    it("handles thrown exceptions", async () => {
      mockSend.mockRejectedValueOnce(new Error("Network error"));
      
      const result = await sendEmail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        type: "general",
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });
});
