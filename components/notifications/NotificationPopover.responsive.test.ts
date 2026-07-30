import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  NOTIFICATION_DESKTOP_NAV_MEDIA_QUERY,
  NOTIFICATION_MOBILE_MEDIA_QUERY,
  isActiveNotificationSurface,
  resolveNotificationSurface,
  type NotificationSurface,
  type NotificationViewport,
} from "./NotificationPopover";

const source = readFileSync(
  new URL("./NotificationPopover.tsx", import.meta.url),
  "utf8",
);

const navbarSource = readFileSync(
  new URL("../layout/Navbar.tsx", import.meta.url),
  "utf8",
);

const VIEWPORTS: NotificationViewport[] = ["mobile", "desktop"];

type MediaState = { mounted: boolean; isDesktopNav: boolean; isMobile: boolean };

// Only these combinations are reachable: the navbar splits at 1024px and the
// drawer breakpoint is 768px, so "desktop nav and phone width" cannot occur.
const WIDTHS: Record<string, Omit<MediaState, "mounted">> = {
  "390px phone": { isDesktopNav: false, isMobile: true },
  "800px tablet": { isDesktopNav: false, isMobile: false },
  "1440px desktop": { isDesktopNav: true, isMobile: false },
};

const surfacesFor = (
  input: MediaState,
): Record<NotificationViewport, NotificationSurface> => ({
  mobile: resolveNotificationSurface({ ...input, viewport: "mobile" }),
  desktop: resolveNotificationSurface({ ...input, viewport: "desktop" }),
});

describe("resolveNotificationSurface", () => {
  test("gives phone width exactly one drawer and no desktop popover", () => {
    expect(surfacesFor({ mounted: true, ...WIDTHS["390px phone"] })).toEqual({
      mobile: "drawer",
      desktop: "none",
    });
  });

  test("gives desktop width exactly one popover and no mobile drawer", () => {
    expect(surfacesFor({ mounted: true, ...WIDTHS["1440px desktop"] })).toEqual({
      mobile: "none",
      desktop: "popover",
    });
  });

  test("keeps the popover in the visible container between the two breakpoints", () => {
    // 769-1023px still shows the navbar's compact container, so the mobile
    // instance owns the trigger there — with a popover, as it always had.
    expect(surfacesFor({ mounted: true, ...WIDTHS["800px tablet"] })).toEqual({
      mobile: "popover",
      desktop: "none",
    });
  });

  test("never resolves two active surfaces, and never zero after hydration", () => {
    for (const [label, width] of Object.entries(WIDTHS)) {
      for (const mounted of [false, true]) {
        const surfaces = surfacesFor({ mounted, ...width });
        const active = VIEWPORTS.filter((viewport) =>
          isActiveNotificationSurface(surfaces[viewport]),
        );
        expect({ label, mounted, active: active.length }).toEqual({
          label,
          mounted,
          active: mounted ? 1 : 0,
        });
      }
    }
  });

  test("resolves the inert placeholder for both instances before the media queries hydrate", () => {
    // Both containers still render server HTML at this point, so both must
    // resolve the same non-interactive fallback rather than a real trigger.
    for (const width of Object.values(WIDTHS)) {
      expect(surfacesFor({ mounted: false, ...width })).toEqual({
        mobile: "placeholder",
        desktop: "placeholder",
      });
    }
    expect(isActiveNotificationSurface("placeholder")).toBe(false);
    expect(isActiveNotificationSurface("none")).toBe(false);
  });

  test("keeps the existing breakpoint vocabulary", () => {
    expect(NOTIFICATION_MOBILE_MEDIA_QUERY).toBe("(max-width: 768px)");
    // Exact complement of Tailwind's `lg:` (min-width: 1024px) navbar split.
    expect(NOTIFICATION_DESKTOP_NAV_MEDIA_QUERY).toBe("(min-width: 1024px)");
    expect(source).toContain("useMediaQuery(NOTIFICATION_MOBILE_MEDIA_QUERY)");
    expect(source).toContain(
      "useMediaQuery(NOTIFICATION_DESKTOP_NAV_MEDIA_QUERY)",
    );
  });
});

describe("notification trigger accessibility", () => {
  test("names every real and fallback trigger without adding visible text", () => {
    // Real trigger, hydration fallback: both labelled, both icon-only.
    expect(
      source.match(/aria-label="Notifications"/g),
    ).toHaveLength(2);
    expect(source).toContain(
      '<Button className={triggerClasses} variant="ghost" aria-label="Notifications">',
    );
    // The bell is decorative once the button itself carries the name.
    expect(source).toContain('<Bell\n        aria-hidden="true"');
    expect(source).toContain('<Bell aria-hidden="true" className="h-5 w-5 text-muted-foreground" />');
    // No unlabelled trigger button may linger.
    expect(source).not.toContain(
      '<Button variant="ghost" size="icon" className="relative h-9 w-9 p-0 rounded-full border">',
    );
    expect(source).not.toContain('<Button className={triggerClasses} variant="ghost">');
  });

  test("keeps the hydration fallback out of the tab order", () => {
    expect(source).toContain('aria-disabled="true"');
    expect(source).toContain("tabIndex={-1}");
  });
});

describe("single-instance mounting", () => {
  test("renders nothing for the instance that does not own the active viewport", () => {
    expect(source).toContain('if (surface === "none") {\n    return null;\n  }');
    expect(source).toContain('if (surface === "drawer") {');
    expect(source).toContain('if (surface === "placeholder") {');
    // The old CSS-only split keyed rendering off the raw media query.
    expect(source).not.toContain("if (isMobile) {\n    return (");
    expect(source).not.toContain("if (!mounted) {\n    return (");
  });

  test("stops the inactive instance from querying notifications", () => {
    expect(source).toContain("enabled: !!user?.id && isActiveSurface,");
    expect(source).not.toContain("enabled: !!user?.id,");
  });

  test("requires an explicit viewport contract from the parent", () => {
    expect(source).toContain(
      "export function NotificationPopover({ viewport }: { viewport: NotificationViewport })",
    );
    expect(navbarSource).toContain(
      '<NotificationPopover key={user.id} viewport="desktop" />',
    );
    expect(navbarSource).toContain(
      '<NotificationPopover key={user.id} viewport="mobile" />',
    );
    // No instance may be mounted without declaring its container.
    expect(navbarSource).not.toContain("<NotificationPopover key={user.id} />");
  });

  test("keeps both responsive containers in the existing breakpoint vocabulary", () => {
    expect(navbarSource).toContain(
      '<div className="hidden lg:flex items-center space-x-4 ml-auto">',
    );
    expect(navbarSource).toContain(
      '<div className="lg:hidden flex items-center ml-auto">',
    );
  });
});

describe("preserved notification behavior", () => {
  test("keeps the unread badge, drawer, popover and detail dialog", () => {
    expect(source).toContain("{unreadCount > 9 ? '9+' : unreadCount}");
    expect(source).toContain("<DrawerTrigger asChild>");
    expect(source).toContain("<PopoverTrigger render={NotificationTrigger} />");
    expect(source).toContain("<DrawerTitle>Notifications</DrawerTitle>");
    expect(source).toContain("{detailDialog}");
    expect(source).toContain("const markAllAsRead = async () => {");
  });
});
