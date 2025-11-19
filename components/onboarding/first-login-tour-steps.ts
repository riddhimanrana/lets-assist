import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Compass,
  ListChecks,
  UserRound,
} from "lucide-react";

export type FirstLoginTourStep = {
  icon: LucideIcon;
  title: string;
  description: string;
  highlight: string;
  selector: string;
  nextRoute?: string;
  prevRoute?: string;
};

export const FIRST_LOGIN_TOUR_STEPS: FirstLoginTourStep[] = [
  {
    icon: Compass,
    title: "Welcome to your dashboard",
    description:
      "This greeting keeps your name, avatar, and quick status right in view every time you sign in.",
    highlight: "Home overview",
    selector: "[data-tour-id='home-greeting']",
  },
  {
    icon: ListChecks,
    title: "Dial in the feed",
    description:
      "Use the search, filters, and view toggles to zero in on volunteer opportunities that fit your schedule.",
    highlight: "Project filters",
    selector: "[data-tour-id='home-project-filters']",
  },
  {
    icon: Bell,
    title: "Scroll live availability",
    description:
      "Projects appear here with live capacity metrics, remaining spots, and quick actions to RSVP.",
    highlight: "Project list",
    selector: "[data-tour-id='home-project-list']",
  },
  {
    icon: UserRound,
    title: "Ready to lead a project?",
    description:
      "Create an opportunity once your trusted profile is complete so organizers can reach you.",
    highlight: "Create project",
    selector: "[data-tour-id='home-create-project']",
    nextRoute: "/dashboard",
  },
  {
    icon: BarChart3,
    title: "Track your impact",
    description:
      "See total verified, self-reported hours, and active projects for a quick overview of your progress.",
    highlight: "Dashboard stats",
    selector: "[data-tour-id='dashboard-stats']",
    prevRoute: "/home",
  },
  {
    icon: CalendarDays,
    title: "Never miss a session",
    description:
      "Upcoming commitments live here so you can jump into project details or log hours right away.",
    highlight: "Upcoming sessions",
    selector: "[data-tour-id='dashboard-upcoming']",
    prevRoute: "/home",
  },
];
