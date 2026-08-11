"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  BookOpenCheck,
  GraduationCap,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

export function SchoolsSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="size-5" aria-hidden="true" />
            School programs and chapter CSF
          </CardTitle>
          <CardDescription>
            Use the workflow configured by your school. CSF requirements,
            deadlines, and eligible service vary by chapter and semester.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BookOpenCheck
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
                DVHS CSF members and officers
              </CardTitle>
              <CardDescription>
                Open the DVHigh CSF organization, then select Help from the CSF
                navigation. That guide uses your current role and the controls
                installed for the chapter.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/organization"
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Open organizations
              </Link>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="csf-member-help-heading">
              <h3
                id="csf-member-help-heading"
                className="mb-3 flex items-center gap-2 font-semibold"
              >
                <UsersRound className="size-4" aria-hidden="true" />
                For chapter members
              </h3>
              <Accordion>
                <AccordionItem value="connect-record">
                  <AccordionTrigger>
                    Connect your CSF student record
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <ol className="list-decimal space-y-1.5 pl-5">
                      <li>
                        Open the class link or student-specific link sent by an
                        officer.
                      </li>
                      <li>
                        Sign in or create your Let&apos;s Assist account with
                        your own verified email.
                      </li>
                      <li>
                        Confirm the class and identity details. Never claim
                        another student&apos;s record.
                      </li>
                      <li>
                        If an exact match cannot be proven, send the request for
                        officer review.
                      </li>
                      <li>
                        After approval, open My CSF to see your reviewed status.
                      </li>
                    </ol>
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      A class link creates no email and grants no officer
                      access.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="member-service">
                  <AccordionTrigger>
                    Activities, signups, and point claims
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <ol className="list-decimal space-y-1.5 pl-5">
                      <li>Open Activities and choose an approved activity.</li>
                      <li>
                        Read its audience, schedule, location, point type, and
                        signup instructions.
                      </li>
                      <li>
                        After service, open Point submissions and add the
                        requested proof.
                      </li>
                      <li>
                        Track officer review on the same page and correct any
                        returned claim.
                      </li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="member-requirements">
                  <AccordionTrigger>
                    Where are the real requirements?
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <p>
                      Open My CSF for your current application, membership, and
                      semester status. The chapter&apos;s published semester
                      policy and deadlines are authoritative.
                    </p>
                    <p className="text-muted-foreground">
                      Let&apos;s Assist does not assume one universal CSF hour
                      or point requirement. Ask a chapter officer when a
                      reviewed record needs to change.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </section>

            <section aria-labelledby="csf-officer-help-heading">
              <h3
                id="csf-officer-help-heading"
                className="mb-3 flex items-center gap-2 font-semibold"
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                For chapter officers and advisers
              </h3>
              <Accordion>
                <AccordionItem value="chapter-setup">
                  <AccordionTrigger>
                    Set up the chapter workspace
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <ol className="list-decimal space-y-1.5 pl-5">
                      <li>
                        Open Classes and configure the semester dates,
                        application window, deadlines, meetings, and policy.
                      </li>
                      <li>
                        Open Imports to preview and reconcile bounded Google
                        Sheet ranges before committing records.
                      </li>
                      <li>
                        Open Members to add records, create class or student
                        links, and resolve account matches.
                      </li>
                      <li>
                        Open Staff access to assign a connected account to an
                        officer position with effective dates.
                      </li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="chapter-operations">
                  <AccordionTrigger>
                    Run applications, service, and communications
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <ul className="list-disc space-y-1.5 pl-5">
                      <li>
                        Applications owns reviewed eligibility, dues, and
                        membership decisions.
                      </li>
                      <li>
                        Classes owns class posts; Service owns activities,
                        meetings, point claims, and verification.
                      </li>
                      <li>
                        Communications separates campaign content, canonical
                        audience snapshots, delivery issues, and settings.
                      </li>
                      <li>
                        Reports and Change history support final reconciliation
                        and semester close.
                      </li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="chapter-help-access">
                  <AccordionTrigger>
                    Why is a workflow missing?
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <p>
                      The CSF Help page only shows officer workflows allowed by
                      the person&apos;s assigned position. Missing access should
                      be reviewed in Staff access, not bypassed with a broader
                      account.
                    </p>
                    <Badge variant="outline">
                      Role-aware and permission-filtered
                    </Badge>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </section>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Other school organizations</CardTitle>
          <CardDescription>
            A school organization without the DVHS CSF plugin uses the normal
            Let&apos;s Assist project, signup, hour, and member-management
            tools.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Ask the organization&apos;s administrator which projects,
            verification process, reports, and deadlines apply. Generic project
            records are not automatically a chapter CSF membership decision.
          </p>
          <Link
            href="/organization/create"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
          >
            Create an organization
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
