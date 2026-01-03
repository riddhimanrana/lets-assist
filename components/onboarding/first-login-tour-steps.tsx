import { Compass, ListChecks, Bell, UserRound, Target, CalendarDays, Building2, Users } from "lucide-react";
import type { Tour } from "nextstepjs";

export const FIRST_LOGIN_TOUR_STEPS: Tour[] = [
  {
    tour: "first-login",
    steps: [
      {
        icon: <Compass className="h-5 w-5" />,
        title: "Welcome to your hub",
        content: (
          <>
            This greeting block keeps you grounded with your name and quick status reminders every time
            you sign in.
          </>
        ),
        selector: "[data-tour-id='home-greeting']",
        side: "right",
        showSkip: true,
        pointerPadding: 12,
      },
      {
        icon: <ListChecks className="h-5 w-5" />,
        title: "Dial in the feed",
        content: (
          <>Use the filters, search, and view toggles to zero in on projects that fit your schedule.</>
        ),
        selector: "[data-tour-id='home-project-filters']",
        side: "bottom",
        pointerPadding: 16,
      },
      {
        icon: <Bell className="h-5 w-5" />,
        title: "Check live availability",
        content: (
          <>Scroll this list to see live capacity, remaining slots, and quick actions for each project.</>
        ),
        selector: "[data-tour-id='home-project-list']",
        side: "left",
        pointerPadding: 20,
      },
      {
        icon: <UserRound className="h-5 w-5" />,
        title: "Ready to lead?",
        content: (
          <>Once you have a trusted profile, spin up a new opportunity directly from this button.</>
        ),
        selector: "[data-tour-id='home-create-project']",
        side: "left",
        pointerPadding: 14,
        nextRoute: "/dashboard",
      },
      {
        icon: <Target className="h-5 w-5" />,
        title: "Track your progress",
        content: (
          <>The dashboard summary cards keep verified hours, self-reported time, and project counts in view.</>
        ),
        selector: "[data-tour-id='dashboard-stats']",
        side: "bottom",
        pointerPadding: 18,
      },
      {
        icon: <CalendarDays className="h-5 w-5" />,
        title: "Never miss a session",
        content: (
          <>Upcoming commitments surface here so you can jump into project details or add hours fast.</>
        ),
        selector: "[data-tour-id='dashboard-upcoming']",
        side: "left",
        pointerPadding: 18,
        nextRoute: "/organization",
      },
      {
        icon: <Building2 className="h-5 w-5" />,
        title: "Discover organizations",
        content: (
          <>Browse verified organizations and see which ones you're already part of.</>
        ),
        selector: "[data-tour-id='org-header']",
        side: "bottom",
        pointerPadding: 16,
      },
      {
        icon: <Users className="h-5 w-5" />,
        title: "Join the community",
        content: (
          <>Create or join organizations to collaborate on volunteer projects with teams and track collective impact.</>
        ),
        selector: "[data-tour-id='org-actions']",
        side: "left",
        pointerPadding: 14,
        showControls: true,
      },
    ],
  },
];
