/**
 * Static content for the fictional home demo. Nothing here comes from a
 * database, and nothing here is shaped like a real project, signup, or
 * profile record. Every identifier carries the `demo-` prefix so it cannot be
 * mistaken for, or collide with, a real UUID.
 */

export const HOME_DEMO_NOTICE = {
  title: "This is a demo with made-up content",
  description:
    "The numbers and projects in this section are fictional. They are not Let's Assist data, and the sample projects do not accept signups.",
} as const;

export const HOME_DEMO_NO_SIGNUP_TEXT = "This example does not accept signups.";

/** The made-up person greeted on the preview route. Not an account. */
export const HOME_DEMO_SAMPLE_PROFILE = {
  name: "Avery Example",
  label: "Sample profile",
} as const;

export const HOME_DEMO_TICK_MS = 4000;

/** Past this tick the counters hold their value, so they cannot run away. */
export const HOME_DEMO_MAX_TICK = 600;

export type HomeDemoCounter = {
  id: `demo-counter-${string}`;
  label: string;
  helper: string;
  start: number;
  /** Amount added on each tick, repeated in order. */
  steps: readonly number[];
};

export const HOME_DEMO_COUNTERS: readonly HomeDemoCounter[] = [
  {
    id: "demo-counter-volunteers",
    label: "Sample volunteers",
    helper: "Made-up number",
    start: 5000,
    steps: [2, 0, 1, 3, 0, 1, 0, 2],
  },
  {
    id: "demo-counter-us-projects",
    label: "Sample US projects",
    helper: "Made-up number",
    start: 492,
    steps: [0, 0, 1, 0, 0, 0, 1, 0, 0],
  },
];

function safeTick(tick: number) {
  if (!Number.isFinite(tick) || tick <= 0) return 0;
  return Math.min(Math.floor(tick), HOME_DEMO_MAX_TICK);
}

/** Total added to a counter after `tick` ticks. Zero at tick zero. */
export function demoCounterDelta(steps: readonly number[], tick: number) {
  const ticks = safeTick(tick);
  const cycle = steps.map((step) =>
    Number.isFinite(step) && step > 0 ? Math.floor(step) : 0,
  );
  if (ticks === 0 || cycle.length === 0) return 0;

  const cycleTotal = cycle.reduce((sum, step) => sum + step, 0);
  const partial = cycle
    .slice(0, ticks % cycle.length)
    .reduce((sum, step) => sum + step, 0);
  return Math.floor(ticks / cycle.length) * cycleTotal + partial;
}

/**
 * The value a sample counter shows at `tick`. The server and the first client
 * render both use tick zero, so they agree. The value never decreases.
 */
export function demoCounterValue(counter: HomeDemoCounter, tick: number) {
  return counter.start + demoCounterDelta(counter.steps, tick);
}

const countFormatter = new Intl.NumberFormat("en-US");

export function formatDemoCount(value: number) {
  return countFormatter.format(value);
}

/** Counters stand still in a hidden tab and for reduced-motion visitors. */
export function shouldRunDemoCounters({
  hidden,
  reducedMotion,
}: {
  hidden: boolean;
  reducedMotion: boolean;
}) {
  return !hidden && !reducedMotion;
}

export type HomeDemoProjectIcon =
  "creek" | "bike" | "reading" | "meal" | "garden" | "shelter";

export type HomeDemoProject = {
  id: `demo-project-${string}`;
  icon: HomeDemoProjectIcon;
  title: string;
  organizer: string;
  city: string;
  state: string;
  place: string;
  schedule: string;
  role: string;
  summary: string;
  tasks: readonly string[];
  bring: string;
  goodFor: string;
};

export const HOME_DEMO_PROJECTS: readonly HomeDemoProject[] = [
  {
    id: "demo-project-austin-creek",
    icon: "creek",
    title: "Creek trail cleanup",
    organizer: "Example Creek Neighbors",
    city: "Austin",
    state: "Texas",
    place: "A neighborhood creek trail",
    schedule: "Saturday morning, 8:30 to 11:00 AM",
    role: "Trail cleanup volunteer",
    summary:
      "Walk a half-mile stretch of trail in pairs, bag litter, and sort recycling at the end.",
    tasks: [
      "Pick up litter along the trail with a partner",
      "Sort bags into trash and recycling at the trailhead",
      "Log what your pair collected on the tally sheet",
    ],
    bring: "Closed-toe shoes and a water bottle. Gloves and bags are provided.",
    goodFor: "First-time volunteers and families",
  },
  {
    id: "demo-project-portland-bikes",
    icon: "bike",
    title: "Bike repair afternoon",
    organizer: "Example Spoke Collective",
    city: "Portland",
    state: "Oregon",
    place: "A community workshop",
    schedule: "Sunday afternoon, 1:00 to 4:00 PM",
    role: "Repair stand helper",
    summary:
      "Help neighbors fix flats and adjust brakes. A lead mechanic shows you each repair first.",
    tasks: [
      "Check bikes in and write down what needs fixing",
      "Patch tubes and pump tires",
      "Hold bikes steady while the mechanic adjusts brakes and gears",
    ],
    bring: "Clothes that can get greasy. Tools are at the workshop.",
    goodFor: "People who like working with their hands",
  },
  {
    id: "demo-project-madison-reading",
    icon: "reading",
    title: "After-school reading buddies",
    organizer: "Example Lakeside Readers",
    city: "Madison",
    state: "Wisconsin",
    place: "A branch library reading room",
    schedule: "Tuesday and Thursday, 3:30 to 5:00 PM",
    role: "Reading buddy",
    summary:
      "Read one-on-one with a first or second grader for 30 minutes, then help with a word game.",
    tasks: [
      "Read a picture book aloud with one student",
      "Let the student read a page back to you",
      "Play a short word game the librarian sets up",
    ],
    bring: "Nothing. Books and games are in the room.",
    goodFor: "Patient listeners, ages 14 and up",
  },
  {
    id: "demo-project-asheville-meal",
    icon: "meal",
    title: "Community supper prep",
    organizer: "Example Ridge Kitchen",
    city: "Asheville",
    state: "North Carolina",
    place: "A shared community kitchen",
    schedule: "Wednesday evening, 4:00 to 6:30 PM",
    role: "Prep cook and server",
    summary:
      "Chop vegetables, plate about 80 suppers, and help serve the first seating.",
    tasks: [
      "Wash and chop vegetables with the kitchen lead",
      "Plate meals on the serving line",
      "Wipe tables and reset chairs between seatings",
    ],
    bring: "Hair tie or hat. Aprons and gloves are provided.",
    goodFor: "Small groups who want to work side by side",
  },
  {
    id: "demo-project-detroit-garden",
    icon: "garden",
    title: "Garden bed build day",
    organizer: "Example Eastside Growers",
    city: "Detroit",
    state: "Michigan",
    place: "A neighborhood garden lot",
    schedule: "Saturday, 10:00 AM to 1:00 PM",
    role: "Garden builder",
    summary:
      "Assemble six raised beds from pre-cut lumber, fill them with soil, and plant fall greens.",
    tasks: [
      "Screw pre-cut boards into bed frames",
      "Wheelbarrow soil from the pile to each bed",
      "Plant kale and collard seedlings in rows",
    ],
    bring: "Work gloves if you have them, and sun protection.",
    goodFor: "Anyone comfortable lifting 20 pounds",
  },
  {
    id: "demo-project-tucson-shelter",
    icon: "shelter",
    title: "Shelter dog morning walks",
    organizer: "Example Desert Paws",
    city: "Tucson",
    state: "Arizona",
    place: "An animal shelter walking loop",
    schedule: "Weekday mornings, 6:30 to 8:00 AM",
    role: "Dog walker",
    summary:
      "Walk two shelter dogs on a shaded loop before the heat, then refill water bowls.",
    tasks: [
      "Leash a dog with help from shelter staff",
      "Walk the quarter-mile loop twice",
      "Refill water bowls and note how the walk went",
    ],
    bring: "Sturdy shoes and a hat. Leashes are provided.",
    goodFor: "Early risers, ages 16 and up",
  },
];
