import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./OrganizationHeader.tsx", import.meta.url),
  "utf8",
);
const actionsSource = readFileSync(
  new URL("./OrganizationHeaderActions.tsx", import.meta.url),
  "utf8",
);
const normalizedSource = source.replace(/\s+/gu, " ");
const normalizedActionsSource = actionsSource.replace(/\s+/gu, " ");

describe("compact organization header actions", () => {
  test("keeps Share a compact action instead of a full-width phone row", () => {
    expect(actionsSource).toContain("onClick={handleShare}");
    expect(normalizedActionsSource).toContain(
      '<Button variant="outline" className="shrink-0" onClick={handleShare}>',
    );
    // No header action may take a full-width phone row any more.
    expect(actionsSource).not.toContain("w-full");
  });

  test("lays compact header actions out inline on one line rather than stacked", () => {
    expect(source).toContain(
      '"flex w-auto shrink-0 flex-row items-center justify-end gap-2"',
    );
    // Actions must never stack into a tall column of their own; the outer row
    // wraps instead so the actions cannot dominate the compact header.
    expect(source).not.toContain(
      '"flex w-auto shrink-0 flex-row flex-wrap items-center justify-end gap-2"',
    );
  });

  test("lets the compact row wrap intentionally instead of overflowing", () => {
    expect(source).toContain(
      '"flex w-full min-w-0 flex-row flex-wrap items-center justify-between gap-2"',
    );
  });

  test("gives the compact identity the free space and constrains its overflow", () => {
    expect(normalizedSource).toContain(
      '"flex min-w-0 grow basis-48 flex-row items-center gap-2.5"',
    );
    expect(normalizedSource).toContain(
      '"flex min-w-0 flex-col items-start gap-1 overflow-hidden text-left"',
    );
    expect(normalizedSource).toContain(
      '<h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">',
    );
    // The title row is capped at the identity width, so a long name ends in
    // an ellipsis and the verified mark stays visible beside it.
    expect(normalizedSource).toContain(
      '<div className="flex max-w-full min-w-0 items-center gap-2">',
    );
  });

  test("truncates compact metadata rows so long values cannot widen the header", () => {
    // Both metadata rows are width-constrained in compact mode.
    expect(normalizedSource.match(/min-w-0 max-w-full/gu)).toHaveLength(2);
    // Username and website are the unbounded values, so both truncate.
    expect(normalizedSource).toContain(
      '<span className="text-muted-foreground truncate text-sm"> @{organization.username} </span>',
    );
    expect(normalizedSource).toContain(
      '<span className="truncate"> {formatOrganizationWebsiteDisplay(organization.website)} </span>',
    );
    expect(normalizedSource).toContain(
      '<div className="flex shrink-0 items-center gap-1 whitespace-nowrap">',
    );
  });

  test("leaves no header icon exposed to assistive technology", () => {
    const iconPattern =
      /<(BadgeCheck|GlobeIcon|UsersIcon|Share2|Plus|UserPlus|Ellipsis|Settings|ShieldAlert|LogOut)\b[^>]*?\/>/g;
    const headerIcons = source.match(iconPattern) ?? [];
    const actionIcons = actionsSource.match(iconPattern) ?? [];
    // Header: two BadgeCheck marks, two GlobeIcon, one UsersIcon.
    expect(headerIcons).toHaveLength(5);
    // Actions: Share2, UserPlus, two Plus, Ellipsis, Settings, UsersIcon,
    // ShieldAlert, LogOut.
    expect(actionIcons).toHaveLength(9);
    for (const element of [...headerIcons, ...actionIcons]) {
      expect(element, `${element} is missing aria-hidden`).toContain(
        'aria-hidden="true"',
      );
    }
  });

  test("names the verified mark for assistive technology", () => {
    expect(
      normalizedSource.match(
        /<span className="sr-only">Verified organization<\/span>/gu,
      ),
    ).toHaveLength(2);
  });

  test("renders the generic header through the shared page header", () => {
    expect(source).toContain(
      'import { PageHeader } from "@/components/layout/PageHeader";',
    );
    expect(normalizedSource).toContain("<PageHeader media={avatar}");
    expect(normalizedSource).toContain("actions={actions}");
    // The generic header no longer centres or stacks its identity on phones.
    expect(source).not.toContain("text-center");
  });
});

describe("organization header actions by role", () => {
  test("shows at most one filled action: Join or New project", () => {
    const filledButtons =
      normalizedActionsSource.match(/<Button className="shrink-0"/gu) ?? [];
    // Join (visitors) and New project (staff, admins) are mutually exclusive.
    expect(filledButtons).toHaveLength(2);
    expect(normalizedActionsSource).toContain(
      "{userRole === null && ( <Button",
    );
    expect(normalizedActionsSource).toContain(
      "{isStaffOrAdmin && showProjectAction && ( <Button",
    );
    expect(normalizedActionsSource).toMatch(
      /\{isAdmin && showInviteAction && \( <Button variant="outline"/u,
    );
  });

  test("Join opens the join-code dialog instead of pointing elsewhere", () => {
    expect(actionsSource).toContain("onClick={() => setShowJoinDialog(true)}");
    expect(actionsSource).toContain("<JoinOrganizationCodeDialog");
    expect(actionsSource).not.toContain("toast.info(");
  });

  test("keeps settings, members, moderation and leave reachable from the menu", () => {
    expect(actionsSource).toContain('aria-label="More organization actions"');
    expect(actionsSource).toContain("`${organizationPath}/settings`");
    expect(actionsSource).toContain("`${organizationPath}?tab=members`");
    expect(actionsSource).toContain("`${organizationPath}/moderation`");
    expect(actionsSource).toContain("onClick={() => setShowLeaveDialog(true)}");
    // Settings is the only admin-only link.
    expect(normalizedActionsSource).toMatch(
      /\{isAdmin && \( <DropdownMenuItem render=\{<Link href=\{`\$\{organizationPath\}\/settings`\} \/>\}/u,
    );
  });

  test("honours plugin overrides that hide Invite and New project", () => {
    expect(actionsSource).toContain("isAdmin && showInviteAction &&");
    expect(actionsSource).toContain("isStaffOrAdmin && showProjectAction &&");
  });
});
