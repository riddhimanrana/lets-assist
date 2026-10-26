import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "./badge";
import { Button } from "./button";

test("filled buttons and badges share their theme primary recipe", () => {
  for (const element of [
    <Button key="button">Create organization</Button>,
    <Badge key="badge">Admin</Badge>,
  ]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
    expect(html).toContain("bg-[image:var(--button-primary-gloss)]");
    expect(html).not.toContain("--badge-primary");
    expect(html).not.toContain("text-foreground");
  }
});
