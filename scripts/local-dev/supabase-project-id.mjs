import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTopLevelProjectId } from "./supabase-gateway-health-core.mjs";

export function localSupabaseProjectId(workDir = process.cwd()) {
  return parseTopLevelProjectId(
    readFileSync(path.resolve(workDir, "supabase/config.toml"), "utf8"),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  let workDir = process.cwd();
  let workDirFlags = 0;
  const requestedProjectIds = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--workdir") {
      workDir = args[++index];
      workDirFlags += 1;
    } else if (argument.startsWith("--workdir=")) {
      workDir = argument.slice(10);
      workDirFlags += 1;
    } else if (argument === "--project-id")
      requestedProjectIds.push(args[++index]);
    else if (argument.startsWith("--project-id="))
      requestedProjectIds.push(argument.slice(13));
    else if (
      argument === "--network-id" ||
      argument.startsWith("--network-id=")
    ) {
      throw new Error(
        "Repository local commands require the canonical project network.",
      );
    }
  }
  if (!workDir || workDirFlags > 1)
    throw new Error(
      "One unambiguous local Supabase work directory is required.",
    );
  const projectId = localSupabaseProjectId(workDir);
  if (
    requestedProjectIds.some(
      (requestedProjectId) => requestedProjectId !== projectId,
    )
  ) {
    throw new Error("The requested local project does not match config.toml.");
  }
  process.stdout.write(projectId);
}
