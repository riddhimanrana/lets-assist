import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import SignUpGeniusImporter from "./SignUpGeniusImporter";

export const metadata: Metadata = {
  title: "Import from SignUpGenius",
  description:
    "Bring a supported public signup into an editable Let's Assist project preview. Review every detail before creating a project.",
};

export default function SignUpGeniusImportPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Bring your signup to Let's Assist"
        description="Paste a public SignUpGenius link, review the details, and make it your own."
      />
      <SignUpGeniusImporter />
    </div>
  );
}
