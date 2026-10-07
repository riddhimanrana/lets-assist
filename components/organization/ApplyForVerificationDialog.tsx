"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

const VERIFICATION_EVIDENCE = [
  {
    title: "Official email",
    description: "Send the request from an address on your own domain.",
  },
  {
    title: "Portfolio evidence",
    description: "Documentation of previous projects.",
  },
  {
    title: "Activity records",
    description: "Proof of volunteer hours and initiatives.",
  },
  {
    title: "Legal documentation",
    description: "Registration certificates or credentials.",
  },
] as const;

const VERIFICATION_STEPS = [
  {
    title: "Send an email",
    description: "Submit verification materials to support@lets-assist.com.",
  },
  { title: "Review", description: "We'll contact you shortly." },
  { title: "Get verified", description: "Receive the verified badge." },
] as const;

/**
 * How an organization applies for the verified badge. Verification is handled
 * over email, so this explains what to send and links to the address.
 */
export function ApplyForVerificationDialog({
  trigger,
}: {
  /** Defaults to an outline "Apply for verification" button. */
  trigger?: React.ReactElement;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          trigger ?? <Button variant="outline">Apply for verification</Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Organization verification</DialogTitle>
          <DialogDescription>
            Get your organization verified to build trust with volunteers and
            partners.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6">
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">What you can send</h3>
            <ul className="text-muted-foreground grid gap-2 text-sm">
              {VERIFICATION_EVIDENCE.map((evidence) => (
                <li key={evidence.title}>
                  <span className="text-foreground font-medium">
                    {evidence.title}.
                  </span>{" "}
                  {evidence.description}
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">How it works</h3>
            <ItemGroup className="gap-1">
              {VERIFICATION_STEPS.map((step, index) => (
                <Item key={step.title} size="sm" className="px-0">
                  <ItemMedia
                    aria-hidden="true"
                    className="bg-muted size-7 rounded-full text-sm font-medium tabular-nums"
                  >
                    {index + 1}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{step.title}</ItemTitle>
                    <ItemDescription>{step.description}</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </section>
        </div>

        <DialogFooter showCloseButton>
          <Button
            render={<a href="mailto:support@lets-assist.com" />}
            nativeButton={false}
          >
            Email support
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
