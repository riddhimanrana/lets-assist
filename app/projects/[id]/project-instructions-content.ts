import type { Project } from "@/types";

type EventType = Project["event_type"];
type VerificationMethod = Project["verification_method"];

export interface InstructionStep {
  title: string;
  body: string;
}

export interface InstructionTopic {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  footnote?: string;
}

export interface InstructionGuide {
  label: string;
  title?: string;
  intro: string;
  steps?: InstructionStep[];
  topics?: InstructionTopic[];
}

export function getProjectTypeGuide(
  eventType: EventType,
): InstructionGuide | null {
  switch (eventType) {
    case "oneTime":
      return {
        label: "One-time event",
        intro:
          "This is a single event that happens on one specific date and time.",
        topics: [
          {
            title: "Event date & time",
            paragraphs: [
              "All volunteers participate during the same time period.",
            ],
          },
          {
            title: "Single location",
            paragraphs: [
              "All volunteers report to the same location for this event.",
            ],
          },
        ],
      };
    case "multiDay":
      return {
        label: "Multi-day event",
        intro: "This event spans multiple days with different time slots.",
        topics: [
          {
            title: "Multiple sessions",
            paragraphs: [
              "This event has sessions across different days and times.",
              "You may sign up for one or more sessions based on your availability.",
            ],
          },
          {
            title: "Flexible scheduling",
            paragraphs: ["Each day may have different time slots available."],
          },
        ],
      };
    case "sameDayMultiArea":
      return {
        label: "Multi-role event",
        intro:
          "This event happens on a single day with multiple roles for volunteers.",
        topics: [
          {
            title: "Different roles",
            paragraphs: [
              "Different volunteer roles may have different responsibilities, locations, or time commitments.",
            ],
          },
          {
            title: "Single day",
            paragraphs: [
              "All roles take place on the same day, but may have different start and end times.",
            ],
          },
        ],
      };
    default:
      return null;
  }
}

export function getSignupSteps(
  eventType: EventType,
  method: VerificationMethod,
): InstructionStep[] {
  const steps: InstructionStep[] = [
    {
      title: "Review project details",
      body: "Read through all project information and requirements.",
    },
    {
      title: "Select available slot",
      body:
        eventType === "oneTime"
          ? "Confirm you're available for the scheduled date and time."
          : eventType === "multiDay"
            ? "Choose which day and time slot works best for you."
            : "Select which role you'd like to volunteer for.",
    },
    {
      title: 'Click the "Sign up" button',
      body: "Complete the signup process by clicking the sign up button for your preferred slot.",
    },
  ];

  if (method !== "signup-only") {
    steps.push({
      title: "Check in on event day",
      body:
        method === "qr-code"
          ? "Scan the QR code when you arrive and leave."
          : method === "manual"
            ? "Check in with the event coordinator upon arrival."
            : "Your hours will be tracked automatically.",
    });
  }

  return steps;
}

export function getCheckInGuide(
  method: VerificationMethod,
): InstructionGuide | null {
  switch (method) {
    case "qr-code":
      return {
        label: "QR code check-in",
        title: "How to check in",
        intro: "Follow these steps to check in and out of your volunteer shift",
        steps: [
          {
            title: "Arrive at the event",
            body: "Get to the event location a few minutes early and look for the check-in area.",
          },
          {
            title: "Find the QR code",
            body: "Look for the event coordinator with the QR code display for your session.",
          },
          {
            title: "Scan to check in",
            body: "Using your phone's camera app, scan the check-in QR code and follow the instructions on screen.",
          },
          {
            title: "Complete your shift",
            body: "When your volunteer time is finished, we automatically track the hours, and if you worked longer or there needs to be any changes contact the project coordinator and they can fix that.",
          },
        ],
        topics: [
          {
            title: "Important notes",
            bullets: [
              "QR codes become available 2 hours before your session starts",
              "Make sure to email the project coordinator within 48 hours as that's the editing window for them to edit times",
              "If you have trouble scanning, ask the event coordinator for help",
            ],
          },
        ],
      };
    case "manual":
      return {
        label: "Manual check-in",
        title: "How to check in",
        intro: "The event coordinator will handle your attendance",
        steps: [
          {
            title: "Arrive and find the coordinator",
            body: "When you arrive, look for the event coordinator or check-in table.",
          },
          {
            title: "Check in",
            body: "Give your name to the coordinator - they'll mark you as present and record your arrival time.",
          },
          {
            title: "Check out when leaving",
            body: "Before you leave, find the coordinator again to check out and record your departure time.",
          },
        ],
        topics: [
          {
            title: "What to expect",
            bullets: [
              "The coordinator will verify your identity and mark your attendance",
              "Your volunteer hours will be calculated and published after the event",
              "You'll receive your certificate once hours are finalized",
            ],
          },
        ],
      };
    case "auto":
      return {
        label: "Automatic check-in",
        title: "Automatic attendance",
        intro: "Your hours are tracked automatically - just show up!",
        steps: [
          {
            title: "Simply arrive on time",
            body: "Show up at the scheduled time and location. No check-in process required!",
          },
          {
            title: "Participate in the event",
            body: "Follow the event coordinator's instructions and contribute your time.",
          },
          {
            title: "Hours credited automatically",
            body: "Your volunteer hours will be automatically credited based on the event schedule.",
          },
        ],
        topics: [
          {
            title: "Automatic benefits",
            bullets: [
              "No need to remember to check in or out",
              "Hours are calculated based on the full event duration",
              "Certificates are generated immediately after the event",
            ],
          },
        ],
      };
    case "signup-only":
      return {
        label: "Sign-up only event",
        title: "Just show up!",
        intro: "This is a simple registration event - no hour tracking",
        steps: [
          {
            title: "Arrive at the event",
            body: "Show up at the scheduled time and location ready to help!",
          },
          {
            title: "Participate",
            body: "Follow the event coordinator's guidance and contribute your time and energy.",
          },
          {
            title: "That's it!",
            body: "No check-in, no check-out - just show up and make a difference.",
          },
        ],
        topics: [
          {
            title: "Event details",
            bullets: [
              "This event doesn't track specific volunteer hours",
              "Your participation will be recognized and appreciated",
              "Focus on contributing and making an impact",
            ],
          },
        ],
      };
    default:
      return null;
  }
}

const eventTypeName = (eventType: EventType, capitalized = false) => {
  const name =
    eventType === "oneTime"
      ? "one-time event"
      : eventType === "multiDay"
        ? "multi-day event"
        : "multi-role event";
  return capitalized ? name.charAt(0).toUpperCase() + name.slice(1) : name;
};

export function getCreatorGuide(
  eventType: EventType,
  method: VerificationMethod,
): InstructionGuide {
  const topics: InstructionTopic[] = [
    {
      title: "Project setup complete",
      paragraphs: [
        "Your project is live and accepting volunteers",
        `Event type: ${eventTypeName(eventType, true)}`,
        `Verification: ${
          method === "qr-code"
            ? "QR code check-in"
            : method === "manual"
              ? "Manual check-in"
              : method === "auto"
                ? "Automatic check-in"
                : "Sign-up only"
        }`,
      ],
    },
    {
      title: "Before the event",
      bullets: [
        'Monitor signups from the "Manage signups" page',
        "Review volunteer information and approve/reject as needed",
        "Download signup lists and contact information",
        ...(method === "qr-code"
          ? ["Print QR codes 1 week before the event starts"]
          : []),
      ],
    },
  ];

  if (method === "qr-code") {
    topics.push({
      title: "During the event: QR code check-in",
      bullets: [
        "Display QR codes at the check-in location",
        "Have volunteers scan to check in when they arrive",
        "Have them scan again when they leave",
        'Monitor attendance from the "Manage attendance" page',
      ],
    });
  } else if (method === "manual") {
    topics.push({
      title: "During the event: manual check-in",
      bullets: [
        'Use the "Check-in volunteers" page to mark attendance',
        "Record arrival and departure times manually",
        "Update volunteer status as they participate",
      ],
    });
  } else if (method === "auto") {
    topics.push({
      title: "During the event: automatic tracking",
      bullets: [
        "Hours are automatically calculated based on your schedule",
        'Monitor the "Manage attendance" page for overview',
        "No manual check-in required",
      ],
    });
  }

  if (method !== "auto") {
    topics.push({
      title: "After the event: managing volunteer hours",
      bullets: [
        "Review and edit volunteer hours within 48 hours",
        "Publish hours to generate certificates",
        "Hours auto-publish after 48 hours if not manually published",
        "Volunteers receive their certificates automatically",
      ],
    });
  }

  topics.push({
    title: "Communication",
    paragraphs: ["Volunteers with accounts will receive notifications for:"],
    bullets: [
      "Signup confirmations and rejections",
      "Project updates and cancellations",
      "Hour publishing and certificate availability",
    ],
    footnote: "Anonymous volunteers only receive email confirmations.",
  });

  return {
    label: "Creator guide",
    title: "Managing your project",
    intro: `Here's how to effectively run your ${eventTypeName(eventType)} with ${method} verification.`,
    topics,
  };
}
