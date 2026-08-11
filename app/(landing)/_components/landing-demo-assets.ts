const HOSTED_PROJECT_IMAGE =
  "https://api.lets-assist.com/storage/v1/object/public/project-images/project_7b3e75d0-78d6-4857-9b21-4bcbf3b744d3_cover_1775090232973.jpeg";
const HOSTED_COORDINATOR_IMAGE =
  "https://api.lets-assist.com/storage/v1/object/public/avatars/b6ee0559-a406-4992-b621-9c5af015adce-1768611242931.jpg?v=1768611243727";
const HOSTED_PROJECT_ID = "7b3e75d0-78d6-4857-9b21-4bcbf3b744d3";

const LOCAL_PROJECT_IMAGE = "/demo/projects/santa-cruz-beach-cleanup.png";
const LOCAL_COORDINATOR_IMAGE = "/demo/avatars/riddhiman-rana.png";
const LOCAL_PROJECT_ID = "10000000-0000-4000-8000-000000000020";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function landingDemoAssets(supabaseUrl: string | undefined) {
  let local = false;
  if (supabaseUrl) {
    try {
      local = LOOPBACK_HOSTS.has(new URL(supabaseUrl).hostname);
    } catch {
      local = false;
    }
  }

  return local
    ? {
        projectId: LOCAL_PROJECT_ID,
        projectImage: LOCAL_PROJECT_IMAGE,
        coordinatorImage: LOCAL_COORDINATOR_IMAGE,
      }
    : {
        projectId: HOSTED_PROJECT_ID,
        projectImage: HOSTED_PROJECT_IMAGE,
        coordinatorImage: HOSTED_COORDINATOR_IMAGE,
      };
}
