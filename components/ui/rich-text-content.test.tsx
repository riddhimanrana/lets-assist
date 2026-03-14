import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichTextContent } from "@/components/ui/rich-text-content";

describe("RichTextContent", () => {
  it("sanitizes unsafe HTML before rendering", () => {
    const { container } = render(
      <RichTextContent content={'<p>Safe</p><script>alert(1)</script><img src=x onerror="alert(2)">'} />
    );

    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("preserves safe links while stripping javascript hrefs", () => {
    const { container, rerender } = render(
      <RichTextContent content={'<p><a href="https://example.com">Safe Link</a></p>'} />
    );

    expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull();

    rerender(<RichTextContent content={'<p><a href="javascript:alert(1)">Bad Link</a></p>'} />);

    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});