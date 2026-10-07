import type { ReactNode } from "react";

/**
 * Long-form reading layout for policies and other prose pages: a 65-character
 * measure, one heading scale, and comfortable line height. Children are plain
 * h2, h3, p, ul and a elements; this wrapper styles them.
 */
export function LongFormPage({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-prose px-4 py-12 sm:px-6">
      <header className="grid gap-2 border-b pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {meta ? <p className="text-muted-foreground text-sm">{meta}</p> : null}
      </header>
      <div className="text-base leading-7 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:font-medium [&_li>ul]:mt-2 [&_p]:mt-3 [&_strong]:font-medium [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </article>
  );
}
