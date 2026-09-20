import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AttendanceTools({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Paper attendance tools">
      <Button
        variant="outline"
        size="sm"
        render={<Link href={`/projects/${projectId}/attendance-sheet`} />}
      >
        Print attendance sheets
      </Button>
      <Button
        variant="outline"
        size="sm"
        render={<Link href={`/projects/${projectId}/paper-signups`} />}
      >
        Scan attendance sheets
      </Button>
      <Button
        variant="outline"
        size="sm"
        render={
          <Link href={`/projects/${projectId}/paper-signups?mode=manual`} />
        }
      >
        Enter attendance manually
      </Button>
    </div>
  );
}
