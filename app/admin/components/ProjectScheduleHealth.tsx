import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  scheduleMaintenanceState,
  type ProjectScheduleHealthResult,
} from "@/lib/admin/project-schedule-health";

export function ProjectScheduleHealth({
  result,
}: {
  result: ProjectScheduleHealthResult;
}) {
  const health = result.data;
  const state = health ? scheduleMaintenanceState(health) : "unavailable";
  return (
    <Card role="region" aria-labelledby="schedule-health-title">
      <CardHeader>
        <CardTitle>
          <h2 id="schedule-health-title">Project schedule health</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {health ? (
          <>
            <p className="text-sm">
              {health.invalid_count === 0
                ? "No upcoming or in-progress published projects currently need schedule correction."
                : `${health.invalid_count} published projects need schedule correction before their status can advance.`}
            </p>
            {state === "no_run" && (
              <Alert variant="warning">
                <AlertDescription>
                  Status maintenance has no recorded run. A zero correction
                  count does not confirm that the worker is running.
                </AlertDescription>
              </Alert>
            )}
            {state === "stale" && (
              <Alert variant="warning">
                <AlertDescription>
                  Status maintenance has not reported within 15 minutes. Check
                  the scheduled job.
                </AlertDescription>
              </Alert>
            )}
            {health.last_run && (
              <p className="text-muted-foreground text-sm">
                Last recorded run:{" "}
                {new Date(health.last_run.checked_at).toLocaleString("en-US", {
                  timeZone: "UTC",
                })}{" "}
                UTC. That run found {health.last_run.invalid_count} schedules
                needing correction.
              </p>
            )}
            {health.projects.length > 0 && (
              <>
                <p className="text-muted-foreground text-sm">
                  Review each source schedule with its organizer. Correct dates,
                  times, and timezone through the project editor after
                  confirming the intended event.
                </p>
                <ul className="grid gap-2 text-sm">
                  {health.projects.map((project) => (
                    <li key={project.id}>
                      <Link
                        href={`/projects/${project.id}`}
                        className="underline underline-offset-4"
                      >
                        {project.title}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        ({project.event_type})
                      </span>
                    </li>
                  ))}
                </ul>
                {health.invalid_count > health.projects.length && (
                  <p className="text-muted-foreground text-sm">
                    Showing the first {health.projects.length} of{" "}
                    {health.invalid_count}. Refresh after corrections to review
                    the next projects.
                  </p>
                )}
              </>
            )}
          </>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
