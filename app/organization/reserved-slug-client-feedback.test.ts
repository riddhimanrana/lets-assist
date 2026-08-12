import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isReservedOrganizationSlug,
  usernameUnavailableMessage,
} from "@/lib/organization/reserved-slugs";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const CREATE_FORM = "app/organization/create/OrganizationCreator.tsx";
const EDIT_FORM = "app/organization/[id]/settings/EditOrganizationForm.tsx";

/**
 * These two forms are `"use client"` React components whose only route into
 * a test process drags in their `"use server"` action modules (and through
 * them `server-only`), and the repository has no DOM test environment, so
 * their rendered behavior cannot be driven directly here. What *can* be
 * pinned without a DOM is the part that actually carries the security and
 * copy contract: the shared helpers are exercised for real below, and the
 * forms are checked to route through those helpers rather than re-deriving
 * the reserved set or the copy locally. The enforcement itself is proven
 * behaviorally elsewhere -- `lib/organization/reserved-slugs.test.ts` for
 * the helpers, `app/organization/create/actions.test.ts` and
 * `app/organization/[id]/settings/server/profile.test.ts` for the Server
 * Actions, and `supabase/tests/database/organization_username_reserved_slugs.test.sql`
 * for the database constraint that backstops both.
 */
describe("organization username reserved-slug client feedback", () => {
  test("the create form derives its instant check from the shared reserved-slug helper", () => {
    const source = read(CREATE_FORM);
    expect(source).toMatch(
      /import\s*\{[^}]*\bisReservedOrganizationSlug\b[^}]*\}\s*from\s*"@\/lib\/organization\/reserved-slugs"/u,
    );
    expect(source).toContain("isReservedOrganizationSlug(e.target.value)");
    // No hardcoded reserved-word literal comparison remains: the create form
    // previously special-cased only `"create"` and missed `"join"` entirely.
    expect(source).not.toMatch(/===\s*["']create["']/u);
    expect(source).not.toMatch(/===\s*["']join["']/u);
  });

  test("both forms answer a reserved username in words, not only with the shared red icon", () => {
    // The submit button is disabled while a username reads as unavailable,
    // so an icon alone leaves the admin with a dead form and no reason.
    for (const path of [CREATE_FORM, EDIT_FORM]) {
      const source = read(path);
      const reservedBranch = source.indexOf("isReservedOrganizationSlug(");
      expect(reservedBranch).toBeGreaterThan(-1);
      const branchBody = source.slice(reservedBranch, reservedBranch + 600);
      expect(branchBody).toContain("setUsernameAvailable(false)");
      expect(branchBody).toContain("usernameUnavailableMessage(true)");
    }
  });

  test("the edit form derives its instant check from the shared reserved-slug helper", () => {
    const source = read(EDIT_FORM);
    expect(source).toMatch(
      /import\s*\{[^}]*\bisReservedOrganizationSlug\b[^}]*\}\s*from\s*"@\/lib\/organization\/reserved-slugs"/u,
    );
    expect(source).toContain("isReservedOrganizationSlug(value)");
  });

  test("neither form re-declares the reserved set or the unavailable copy locally", () => {
    for (const path of [CREATE_FORM, EDIT_FORM]) {
      const source = read(path);
      expect(source).not.toContain("RESERVED_ORGANIZATION_SLUGS = ");
      expect(source).not.toContain("function usernameUnavailableMessage");
      expect(source).not.toContain('"That username is reserved');
      expect(source).not.toContain('"Username is already taken"');
    }
  });
});

/**
 * A username can be unavailable because it is taken or because it is
 * reserved -- two different facts that need two different messages. The edit
 * form's submit handler used to call both cases "already taken", which is
 * false for the reserved case: no amount of retrying, and no alternative
 * case or whitespace spelling, makes a reserved slug available.
 */
describe("organization username unavailable copy", () => {
  test("usernameUnavailableMessage returns the reserved message only for the reserved case", () => {
    expect(usernameUnavailableMessage(true)).toBe(
      "That username is reserved and can't be used",
    );
    expect(usernameUnavailableMessage(false)).toBe("Username is already taken");
  });

  test("the reserved message is the truthful one for every reserved spelling", () => {
    for (const value of ["create", "JOIN", "  Create  ", "ｊｏｉｎ"]) {
      expect(isReservedOrganizationSlug(value)).toBe(true);
      expect(
        usernameUnavailableMessage(isReservedOrganizationSlug(value)),
      ).toBe("That username is reserved and can't be used");
    }
  });

  test("an ordinary unavailable username still reports the taken message", () => {
    for (const value of ["creators", "joint-venture", "lets-assist"]) {
      expect(isReservedOrganizationSlug(value)).toBe(false);
      expect(
        usernameUnavailableMessage(isReservedOrganizationSlug(value)),
      ).toBe("Username is already taken");
    }
  });

  test("the create and edit Server Actions return the shared copy, not their own literals", () => {
    for (const path of [
      "app/organization/create/actions.ts",
      "app/organization/[id]/settings/server/profile.ts",
    ]) {
      const source = read(path);
      expect(source).toMatch(
        /import\s*\{[^}]*\busernameUnavailableMessage\b[^}]*\}\s*from\s*"@\/lib\/organization\/reserved-slugs"/u,
      );
      expect(source).toContain("usernameUnavailableMessage(true)");
      expect(source).not.toContain('"That username is reserved');
    }
  });
});

/**
 * The edit form must keep its legacy editing semantics: an organization
 * whose username is unchanged is never re-validated against availability or
 * the reserved set, so an existing organization can always save its other
 * settings. The reserved check must therefore sit inside the
 * "username changed" branch, and must run before the network round trip
 * that can only ever prove "taken", never "reserved".
 */
describe("organization edit form reserved-slug submit ordering", () => {
  test("the reserved check precedes the availability round trip inside the changed-username branch", () => {
    const source = read(EDIT_FORM);
    const onSubmitStart = source.indexOf("const onSubmit = async");
    expect(onSubmitStart).toBeGreaterThan(-1);
    const onSubmitBody = source.slice(onSubmitStart, onSubmitStart + 1500);

    const changedBranchIndex = onSubmitBody.indexOf(
      "data.username !== currentUsername",
    );
    const reservedCheckIndex = onSubmitBody.indexOf(
      "isReservedOrganizationSlug(data.username)",
    );
    const reservedMessageIndex = onSubmitBody.indexOf(
      "usernameUnavailableMessage(true)",
    );
    const takenCheckIndex = onSubmitBody.indexOf("checkUsernameAvailability(");
    const takenMessageIndex = onSubmitBody.indexOf(
      "usernameUnavailableMessage(false)",
    );

    for (const index of [
      changedBranchIndex,
      reservedCheckIndex,
      reservedMessageIndex,
      takenCheckIndex,
      takenMessageIndex,
    ]) {
      expect(index).toBeGreaterThan(-1);
    }

    // Unchanged usernames never reach either check.
    expect(changedBranchIndex).toBeLessThan(reservedCheckIndex);
    expect(reservedCheckIndex).toBeLessThan(takenCheckIndex);
    expect(reservedMessageIndex).toBeLessThan(takenMessageIndex);
  });

  test("the blur handler short-circuits an unchanged username before any check", () => {
    const source = read(EDIT_FORM);
    const blurStart = source.indexOf("const handleUsernameBlur = async");
    expect(blurStart).toBeGreaterThan(-1);
    const blurBody = source.slice(blurStart, blurStart + 900);

    const unchangedIndex = blurBody.indexOf("value === currentUsername");
    const reservedIndex = blurBody.indexOf("isReservedOrganizationSlug(value)");
    expect(unchangedIndex).toBeGreaterThan(-1);
    expect(reservedIndex).toBeGreaterThan(-1);
    expect(unchangedIndex).toBeLessThan(reservedIndex);
  });
});
