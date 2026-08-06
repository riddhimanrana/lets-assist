export const IDS = {
  primaryOrg: "10000000-0000-4000-8000-000000000001",
  nonprofitOrg: "10000000-0000-4000-8000-000000000002",
  schoolOrg: "10000000-0000-4000-8000-000000000003",
  csfOrg: "10000000-0000-4000-8000-000000000004",
  publicProject: "10000000-0000-4000-8000-000000000020",
  orgProject: "10000000-0000-4000-8000-000000000021",
  csfTermS26: "10000000-0000-4000-8000-000000000101",
  csfTermF25: "10000000-0000-4000-8000-000000000114",
  csfCohort2028: "10000000-0000-4000-8000-000000000102",
  csfCohort2027: "10000000-0000-4000-8000-000000000115",
  csfCohort2029: "10000000-0000-4000-8000-000000000116",
  csfProfileMember: "10000000-0000-4000-8000-000000000103",
  csfProfileRestricted: "10000000-0000-4000-8000-000000000104",
  csfProfileOfficer: "10000000-0000-4000-8000-000000000117",
  csfProfileComplete: "10000000-0000-4000-8000-000000000118",
  csfProfilePending: "10000000-0000-4000-8000-000000000119",
  csfProfileMissingHours: "10000000-0000-4000-8000-000000000120",
  csfProfileDuplicate: "10000000-0000-4000-8000-000000000121",
  csfSheetSource: "10000000-0000-4000-8000-000000000105",
  csfSheetJobPreview: "10000000-0000-4000-8000-000000000122",
  csfSheetJobCommit: "10000000-0000-4000-8000-000000000123",
  csfOpportunity: "10000000-0000-4000-8000-000000000106",
  csfOpportunityFoodBank: "10000000-0000-4000-8000-000000000124",
  csfOpportunityCleanup: "10000000-0000-4000-8000-000000000125",
  csfOpportunityTutoring: "10000000-0000-4000-8000-000000000126",
  csfOpportunityDrive: "10000000-0000-4000-8000-000000000127",
  csfActivityOpportunity: "10000000-0000-4000-8000-000000000107",
  csfActivityMeeting: "10000000-0000-4000-8000-000000000108",
  csfMeetingGeneral: "10000000-0000-4000-8000-000000000128",
  csfMeetingService: "10000000-0000-4000-8000-000000000129",
  csfRestriction: "10000000-0000-4000-8000-000000000109",
  csfRoleOwner: "10000000-0000-4000-8000-000000000110",
  csfRoleActivityCoordinator: "10000000-0000-4000-8000-000000000111",
  csfRoleCoPresident: "10000000-0000-4000-8000-000000000130",
  csfRoleSecretary: "10000000-0000-4000-8000-000000000131",
  csfRoleAdvisor: "10000000-0000-4000-8000-000000000132",
  csfRoleVicePresidentMembership: "20000000-0000-4000-8000-000000000001",
  csfRoleVicePresidentPublicity: "20000000-0000-4000-8000-000000000002",
  csfRoleVicePresidentClubs: "20000000-0000-4000-8000-000000000003",
  csfRoleTreasurer: "20000000-0000-4000-8000-000000000004",
  csfRoleWebMaster: "20000000-0000-4000-8000-000000000005",
  csfRoleDataManagement: "20000000-0000-4000-8000-000000000006",
  csfStaffPosition: "10000000-0000-4000-8000-000000000112",
  csfStaffSecretary: "10000000-0000-4000-8000-000000000133",
  csfStaffAdvisor: "20000000-0000-4000-8000-000000000101",
  csfStaffCoPresidentOne: "20000000-0000-4000-8000-000000000102",
  csfStaffCoPresidentTwo: "20000000-0000-4000-8000-000000000103",
  csfStaffVicePresidentMembership: "20000000-0000-4000-8000-000000000104",
  csfStaffVicePresidentPublicity: "20000000-0000-4000-8000-000000000105",
  csfStaffVicePresidentClubs: "20000000-0000-4000-8000-000000000106",
  csfStaffTreasurer: "20000000-0000-4000-8000-000000000107",
  csfStaffWebMaster: "20000000-0000-4000-8000-000000000108",
  csfStaffActivityCoordinatorTwo: "20000000-0000-4000-8000-000000000109",
  csfStaffActivityCoordinatorThree: "20000000-0000-4000-8000-000000000110",
  csfStaffActivityCoordinatorFour: "20000000-0000-4000-8000-000000000111",
  csfStaffActivityCoordinatorFive: "20000000-0000-4000-8000-000000000112",
  csfStaffDataManagement: "20000000-0000-4000-8000-000000000113",
  csfPartnerClub: "10000000-0000-4000-8000-000000000113",
  csfPartnerLibrary: "10000000-0000-4000-8000-000000000134",
  csfPartnerBatch: "10000000-0000-4000-8000-000000000135",
  csfAnnouncementPinned: "10000000-0000-4000-8000-000000000136",
  csfAnnouncementOfficer: "10000000-0000-4000-8000-000000000137",
};

export function fixtureJoinCode(seed) {
  const checksum = [...seed].reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) % 900_000,
    0,
  );
  return String(100_000 + checksum).slice(-6);
}

export function resolveFixturePassword(env = process.env) {
  const password = env.CSF_LOCAL_TEST_PASSWORD ?? env.DV_LOCAL_TEST_PASSWORD;
  if (!password) {
    throw new Error(
      "Set CSF_LOCAL_TEST_PASSWORD or DV_LOCAL_TEST_PASSWORD before seeding local platform fixtures.",
    );
  }
  return password;
}

const accounts = [
  {
    key: "developer",
    email: "platform.admin@local.test",
    fullName: "Riddhiman Rana",
    avatarUrl: "/demo/avatars/riddhiman-rana.png",
    superAdmin: true,
    roles: ["admin", "admin", "admin", "admin"],
  },
  {
    key: "staff",
    email: "platform.staff@local.test",
    fullName: "Platform Staff",
    roles: ["staff", "staff", null, null],
  },
  {
    key: "member",
    email: "platform.member@local.test",
    fullName: "Platform Member",
    roles: ["member", null, "member", null],
  },
  {
    key: "outsider",
    email: "platform.outsider@local.test",
    fullName: "Platform Outsider",
    roles: [null, null, null, null],
  },
  {
    key: "csfAdmin",
    email: "csf.admin@local.test",
    fullName: "Riddhiman Rana",
    avatarUrl: "/demo/avatars/riddhiman-rana.png",
    roles: [null, null, null, "admin"],
  },
  {
    key: "csfOfficer",
    email: "csf.officer@local.test",
    fullName: "Priya Shah",
    avatarUrl: "/demo/avatars/priya-shah.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfAdviser",
    email: "csf.adviser@local.test",
    fullName: "Dr. Elena Park",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfCoPresidentOne",
    email: "csf.co-president-one@local.test",
    fullName: "Maya Chen",
    avatarUrl: "/demo/avatars/maya-chen.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfCoPresidentTwo",
    email: "csf.co-president-two@local.test",
    fullName: "Jordan Lee",
    avatarUrl: "/demo/avatars/jordan-lee.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfVpMembership",
    email: "csf.vp-membership@local.test",
    fullName: "Avery Patel",
    avatarUrl: "/demo/avatars/avery-patel.png",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfVpPublicity",
    email: "csf.vp-publicity@local.test",
    fullName: "Sofia Nguyen",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfVpClubs",
    email: "csf.vp-clubs@local.test",
    fullName: "Ethan Wong",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfTreasurer",
    email: "csf.treasurer@local.test",
    fullName: "Nina Brooks",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfSecretary",
    email: "csf.secretary@local.test",
    fullName: "Lena Kim",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfWebMaster",
    email: "csf.web-master@local.test",
    fullName: "Marcus Reed",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorTwo",
    email: "csf.activity-two@local.test",
    fullName: "Grace Lin",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorThree",
    email: "csf.activity-three@local.test",
    fullName: "Noah Singh",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorFour",
    email: "csf.activity-four@local.test",
    fullName: "Isabella Nguyen",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfActivityCoordinatorFive",
    email: "csf.activity-five@local.test",
    fullName: "Lucas Brown",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfDataManagement",
    email: "csf.data-management@local.test",
    fullName: "Aarav Mehta",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfApplicant",
    email: "csf.applicant@local.test",
    fullName: "Evan Chen",
    roles: [null, null, null, "member"],
  },
  {
    key: "csfMember",
    email: "student.2028@local.test",
    fullName: "Aarav Mehta",
    roles: [null, null, null, "member"],
  },
];

// Every CSF fixture actor is a DVHS CSF profile record, so shared local mode
// never creates one. The non-CSF platform accounts are untouched.

const pluginKeys = [
  "calendar-tools",
  "community-impact-radar",
  "dvhs-csf",
  "family-liaison-workbench",
];

const pluginCatalogRows = [
  {
    key: "calendar-tools",
    name: "Calendar Tools",
    description:
      "Server-rendered calendar workflow helpers for organization projects.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "community-impact-radar",
    name: "Community Impact Radar",
    description:
      "Organization impact analytics surfaces backed by host-controlled read paths.",
    visibility: "global",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "dvhs-csf",
    name: "DVHS CSF",
    description:
      "Private CSF workflow system for cohort membership, applications, officer roles, points, posts, and sheets.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "family-liaison-workbench",
    name: "Family Liaison Workbench",
    description:
      "Staff-only liaison workflow surfaces for signup and family support pilots.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
];

export function buildSeedFixtureSets(seedsDvhsCsf) {
  const seededAccounts = seedsDvhsCsf
    ? accounts
    : accounts.filter((account) => !account.key.startsWith("csf"));
  const seededPluginKeys = seedsDvhsCsf
    ? pluginKeys
    : pluginKeys.filter((key) => key !== "dvhs-csf");
  const seededPluginCatalogRows = pluginCatalogRows.filter((row) =>
    seededPluginKeys.includes(row.key),
  );
  return { seededAccounts, seededPluginKeys, seededPluginCatalogRows };
}
