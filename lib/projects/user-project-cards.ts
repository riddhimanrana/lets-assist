export function isHoursPublished(
  published: unknown,
  scheduleId: unknown,
): boolean {
  if (
    typeof scheduleId !== "string" ||
    scheduleId.length === 0 ||
    scheduleId.trim() !== scheduleId ||
    !published ||
    typeof published !== "object" ||
    Array.isArray(published) ||
    !Object.hasOwn(published, scheduleId)
  )
    return false;
  return (published as Record<string, unknown>)[scheduleId] === true;
}

export function deduplicateVolunteerProjectCards<
  TProject extends { id: string; areHoursPublished?: boolean },
>(projects: TProject[]): TProject[] {
  const projectsById = new Map<string, TProject>();

  for (const project of projects) {
    const existing = projectsById.get(project.id);
    if (!existing) {
      projectsById.set(project.id, project);
      continue;
    }

    if (project.areHoursPublished && !existing.areHoursPublished) {
      projectsById.set(project.id, {
        ...existing,
        areHoursPublished: true,
      });
    }
  }

  return [...projectsById.values()];
}
