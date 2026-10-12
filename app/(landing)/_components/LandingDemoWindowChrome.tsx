import { Badge } from "@/components/ui/badge";

export function LandingDemoWindowChrome({
  displayUrl,
}: {
  displayUrl: string;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b bg-muted/30 px-4 py-3 sm:gap-4 sm:px-5 md:grid-cols-[1fr_auto_1fr]">
      <div className="flex items-center gap-2" aria-hidden>
        <span className="size-2.5 rounded-full bg-destructive/70" />
        <span className="size-2.5 rounded-full bg-warning/70" />
        <span className="size-2.5 rounded-full bg-success/70" />
      </div>
      <div className="min-w-0 text-center">
        <p className="hidden truncate rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground sm:block sm:px-4">
          {displayUrl}
        </p>
      </div>
      <Badge variant="outline" className="justify-self-end">
        Sample project
      </Badge>
    </div>
  );
}
