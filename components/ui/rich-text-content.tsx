"use client";

import { useMemo } from "react";

import { RICH_TEXT_PROSE_CLASSNAME } from "@/components/ui/rich-text-classnames";
import { sanitizeRichTextHtml } from "@/lib/security/html.client";
import { cn } from "@/lib/utils";

interface RichTextContentProps {
  content: string;
  className?: string;
}

export function RichTextContent({ content, className }: RichTextContentProps) {
  const sanitizedContent = useMemo(
    () => sanitizeRichTextHtml(content),
    [content],
  );

  return (
    <div
      className={cn(RICH_TEXT_PROSE_CLASSNAME, className)}
      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
    />
  );
}
