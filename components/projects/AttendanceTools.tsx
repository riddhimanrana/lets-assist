import Link from "next/link";
import { PencilLine, Printer, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AttendanceTools({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Paper attendance tools">
      <Button
        variant="outline"
        size="sm"
        render={<Link href={`/projects/${projectId}/attendance-sheet`} />}
      >
        <Printer data-icon="inline-start" />
        Print attendance sheet
      </Button>
      <Button
        variant="outline"
        size="sm"
        render={<Link href={`/projects/${projectId}/paper-signups`} />}
      >
        <ScanLine data-icon="inline-start" />
        Scan completed sheets
      </Button>
      <Button
        variant="outline"
        size="sm"
        render={
          <Link href={`/projects/${projectId}/paper-signups?mode=manual`} />
        }
      >
        <PencilLine data-icon="inline-start" />
        Add attendance manually
      </Button>
    </div>
  );
}
