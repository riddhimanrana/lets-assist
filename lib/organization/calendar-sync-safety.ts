type QueryError = { message?: string } | null;

type QueryResult<T> = {
  data: T[] | null;
  error: QueryError;
};

export function resolveCalendarSyncSources<TProject, TEvent>(
  projectsResult: QueryResult<TProject>,
  existingEventsResult: QueryResult<TEvent>,
):
  | { ok: true; projects: TProject[]; existingEvents: TEvent[] }
  | { ok: false; error: string } {
  if (projectsResult.error) {
    return { ok: false, error: "Failed to load organization projects" };
  }

  if (existingEventsResult.error) {
    return { ok: false, error: "Failed to load existing calendar events" };
  }

  return {
    ok: true,
    projects: projectsResult.data ?? [],
    existingEvents: existingEventsResult.data ?? [],
  };
}
