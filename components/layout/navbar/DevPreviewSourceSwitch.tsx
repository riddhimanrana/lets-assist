"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type PreviewSource = "local" | "remote";

type Props = {
  source: PreviewSource;
  onSelect: (source: PreviewSource) => void;
};

/** Local-development only: picks which database the preview reads from. */
export function DevPreviewSourceSwitch({ source, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">
        Local dev data source
      </span>
      <ToggleGroup
        variant="outline"
        size="sm"
        className="w-full"
        value={[source]}
        onValueChange={(next) => {
          const value = next[0] as PreviewSource | undefined;
          if (value && value !== source) onSelect(value);
        }}
        aria-label="Local dev data source"
      >
        <ToggleGroupItem value="local" className="flex-1">
          Local
        </ToggleGroupItem>
        <ToggleGroupItem value="remote" className="flex-1">
          Remote (RO)
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
