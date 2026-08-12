import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ComponentType, ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";

let routeReady = false;
let resumeRoute: () => void = () => {};
const suspendedRoute = new Promise<void>((resolve) => {
  resumeRoute = () => {
    routeReady = true;
    resolve();
  };
});

mock.module("next/navigation", () => ({
  usePathname: () => "/organization/dvhighcsf",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => {
    if (!routeReady) {
      throw suspendedRoute;
    }
    return new URLSearchParams();
  },
}));

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

mock.module("@/components/onboarding/InitialOnboardingModal", () => ({
  default: () => null,
}));

mock.module("@/components/onboarding/FirstLoginTour", () => ({
  default: () => null,
}));

let GlobalNotificationProvider: ComponentType<{ children: ReactNode }>;
let useNotification: typeof import("./NotificationContext").useNotification;

beforeAll(async () => {
  const [globalProviderModule, notificationContextModule] = await Promise.all([
    import("./GlobalNotificationProvider"),
    import("./NotificationContext"),
  ]);

  GlobalNotificationProvider = globalProviderModule.default;
  useNotification = notificationContextModule.useNotification;
});

function NotificationConsumer() {
  useNotification();
  return <span>notification-boundary-ready</span>;
}

describe("global notification provider boundary", () => {
  test("keeps notification context available while route state suspends", async () => {
    const stream = await renderToReadableStream(
      <GlobalNotificationProvider>
        <NotificationConsumer />
      </GlobalNotificationProvider>,
    );
    resumeRoute();
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("notification-boundary-ready");
  });
});
