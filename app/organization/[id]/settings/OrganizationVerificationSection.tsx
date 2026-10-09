import { Calendar, Folders, Globe, Mail, ShieldCheck } from "lucide-react";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL = "support@lets-assist.com";

const EVIDENCE = [
  {
    icon: Globe,
    title: "Official email",
    description: "Email us from your organization's own domain.",
  },
  {
    icon: Folders,
    title: "Portfolio evidence",
    description: "Documentation of previous projects.",
  },
  {
    icon: Calendar,
    title: "Activity records",
    description: "Proof of volunteer hours and initiatives.",
  },
  {
    icon: ShieldCheck,
    title: "Legal documentation",
    description: "Registration certificates or credentials.",
  },
] as const;

const STEPS = [
  `Send your verification materials to ${SUPPORT_EMAIL}.`,
  "We review them and contact you shortly.",
  "Your organization receives the verified badge.",
] as const;

/** Current verification state and, when not verified, how to apply. */
export default function OrganizationVerificationSection({
  verified,
}: {
  verified: boolean;
}) {
  if (verified) {
    return (
      <SettingsSection
        title="Verification"
        description="This organization is verified. The badge shows next to its name."
        status={<Badge variant="success">Verified</Badge>}
      />
    );
  }

  return (
    <SettingsSection
      title="Verification"
      description="Get verified to build trust with volunteers and partners."
      status={<Badge variant="neutral">Not verified</Badge>}
      contentClassName="gap-6"
      footerHint={`Send your materials to ${SUPPORT_EMAIL}.`}
      footer={
        <Button
          variant="outline"
          render={<a href={`mailto:${SUPPORT_EMAIL}`} />}
        >
          <Mail data-icon="inline-start" aria-hidden="true" />
          Apply for verification
        </Button>
      }
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">What you can send</h3>
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {EVIDENCE.map((entry) => (
            <li key={entry.title} className="flex items-start gap-2.5">
              <entry.icon
                aria-hidden="true"
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
              />
              <div className="grid gap-0.5">
                <p className="text-sm leading-5 font-medium">{entry.title}</p>
                <p className="text-muted-foreground text-sm">
                  {entry.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">How it works</h3>
        <ol className="text-muted-foreground grid list-decimal gap-1 pl-5 text-sm">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </SettingsSection>
  );
}
