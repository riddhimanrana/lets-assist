import { notFound } from "next/navigation";
import { z } from "zod";

import { UnsubscribeRequestForm } from "./UnsubscribeRequestForm";

/**
 * Public unsubscribe page for one chapter announcement topic.
 *
 * Campaign email bodies are byte-identical for every recipient, so the mail
 * can only carry this organization+topic URL. The page collects an address,
 * and confirmation happens through a token mailed to that address — see
 * ./actions.ts for why the response never reveals who receives chapter mail.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  topicKey: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9_.-]{0,62}[a-z0-9])?$/)
    .refine((value) => value !== "transactional"),
});

export const metadata = {
  title: "Unsubscribe from announcements",
  robots: { index: false },
};

export default async function CsfUnsubscribePage({
  params,
}: {
  params: Promise<{ organizationId: string; topicKey: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Unsubscribe from announcement emails
      </h1>
      <p className="text-muted-foreground mt-3 text-sm leading-6">
        Enter the email address that receives chapter announcements. If that
        address gets our mail, we&apos;ll send it a confirmation link — the
        unsubscribe takes effect once you click it. Required emails about your
        own account or membership are unaffected.
      </p>
      <UnsubscribeRequestForm
        organizationId={parsed.data.organizationId}
        topicKey={parsed.data.topicKey}
      />
    </main>
  );
}
