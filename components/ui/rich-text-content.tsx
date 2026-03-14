"use client";

import { useMemo } from "react";

import { sanitizeRichTextHtml } from "@/lib/security/html.client";
import { cn } from "@/lib/utils";

interface RichTextContentProps {
  content: string;
  className?: string;
}

export function RichTextContent({ content, className }: RichTextContentProps) {
  const sanitizedContent = useMemo(() => sanitizeRichTextHtml(content), [content]);

  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0 [&_li_p]:my-0 [&_p]:min-h-[1.5em] text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground", className)}
      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
    />
  );
}