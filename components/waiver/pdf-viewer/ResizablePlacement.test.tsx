import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { ResizablePlacement } from "./ResizablePlacement";

const viewport = {
  convertToViewportPoint: (x: number, y: number) => [x, y],
} as ComponentProps<typeof ResizablePlacement>["viewport"];

for (const fieldType of ["signature", "text"] as const) {
  test(`${fieldType} placement label uses its fill's foreground`, () => {
    const html = renderToStaticMarkup(
      <ResizablePlacement
        placement={{
          id: "synthetic-field",
          label: "Synthetic field",
          signerRoleKey: "volunteer",
          fieldType,
          required: true,
          pageIndex: 0,
          rect: { x: 0, y: 0, width: 150, height: 40 },
        }}
        isSelected={false}
        viewport={viewport}
        onPlacementClick={() => {}}
        clampRectToPage={(rect) => rect}
        mode="view"
      />,
    );
    const labelClass = html.match(
      /<div class="([^"]+)">Synthetic field<\/div>/u,
    )?.[1];
    expect(labelClass).toBeDefined();
    if (fieldType === "signature") {
      expect(labelClass).toContain("bg-primary text-primary-foreground");
      expect(labelClass).not.toContain("text-background");
    } else {
      expect(labelClass).toContain("bg-info text-background");
    }
  });
}
