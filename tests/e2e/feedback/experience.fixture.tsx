import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ExperienceFeedbackForm } from "@/components/feedback/ExperienceFeedbackForm";
import { CsfExperiencePrompt } from "@/lib/plugins/private/plugins/dvhs-csf/components/CsfExperiencePrompt";

const params = new URLSearchParams(location.search);
const calls: unknown[] = [];
Object.assign(globalThis, { experienceCalls: calls });
let failed = false;
async function save(change: { rating: number } | { comment: string }) {
  calls.push(change);
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (
    !failed &&
    params.get("fail") === ("rating" in change ? "rating" : "comment")
  ) {
    failed = true;
    return { success: false, error: "Connection interrupted. Try again." };
  }
  return { success: true };
}
function Fixture() {
  const [scope, setScope] = useState(0);
  return params.has("prompt") ? (
    <>
      {params.has("scope-swap") ? (
        <button onClick={() => setScope(1)}>Switch scope</button>
      ) : null}
      <CsfExperiencePrompt
        organizationId="fixture-org"
        termId={`fixture-term-${scope}`}
        eligible={!params.has("ineligible") && scope === 0}
      />
    </>
  ) : (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-xl font-semibold">How was using Let's Assist?</h1>
      <ExperienceFeedbackForm save={save} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
