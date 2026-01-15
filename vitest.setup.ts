import { vi } from "vitest";

process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN = "test-worker-token";
process.env.PROJECT_CANCELLATION_WORKER_ENABLED = "true";
process.env.RESEND_API_KEY = "test-resend-key";

vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
