import { beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";

let state: unknown[];
let cursor: number;
let publishCalls: string[];
let deleteCalls: string[];

mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in state)) state[slot] = initial;
    return [
      state[slot],
      (next: unknown) => {
        state[slot] =
          typeof next === "function"
            ? (next as (current: unknown) => unknown)(state[slot])
            : next;
      },
    ];
  },
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
mock.module("@/app/projects/create/actions", () => ({
  publishDraft: async (draftId: string) => {
    publishCalls.push(draftId);
    return { error: "Fictional publish refusal" };
  },
  deleteDraft: async (draftId: string) => {
    deleteCalls.push(draftId);
    return {};
  },
}));
mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));
const { default: DraftsClient } = await import("./DraftsClient");
const { default: Link } = await import("next/link");
const { AlertDialog } = await import("@/components/ui/alert-dialog");
const { DropdownMenuItem } = await import("@/components/ui/dropdown-menu");
type Node = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (React.isValidElement<Record<string, unknown>>(value))
    return text(value.props.children);
  return "";
}
const drafts: Parameters<typeof DraftsClient>[0]["drafts"] = [
  {
    id: "fictional draft/1",
    title: "Fictional cleanup",
    description: "",
    location: "",
    event_type: "oneTime",
    schedule: null,
    cover_image_url: null,
    created_at: "2026-01-05T12:00:00.000Z",
    workflow_status: "draft",
    organization: null,
  },
];
function render() {
  cursor = 0;
  return DraftsClient({ drafts });
}
function menuItems(output: unknown) {
  return nodes(output).filter((node) => node.type === DropdownMenuItem);
}
beforeEach(() => {
  state = [];
  cursor = 0;
  publishCalls = [];
  deleteCalls = [];
});

test("Continue editing is a menu item rendered as the editor link", () => {
  const [edit] = menuItems(render());
  expect(text(edit)).toContain("Continue editing");
  const rendered = edit.props.render;
  expect(React.isValidElement<Record<string, unknown>>(rendered)).toBe(true);
  const link = rendered as Node;
  expect(link.type).toBe(Link);
  expect(link.props.href).toBe("/projects/create?draft=fictional%20draft%2F1");
  // No second focusable link inside the item.
  expect(
    nodes(edit.props.children).filter(
      (node) => node.type === Link || node.type === "a",
    ),
  ).toHaveLength(0);
  expect(edit.props.onClick).toBeUndefined();
});

test("Publish now still publishes that draft and keeps the refusal on it", async () => {
  const items = menuItems(render());
  expect(items).toHaveLength(3);
  expect(text(items[1])).toContain("Publish now");
  await (items[1].props.onClick as () => Promise<void>)();
  expect(publishCalls).toEqual(["fictional draft/1"]);
  expect(text(render())).toContain("Fictional publish refusal");
});

test("Delete draft still asks for confirmation before deleting", () => {
  const items = menuItems(render());
  expect(text(items[2])).toContain("Delete draft");
  expect(items[2].props.variant).toBe("destructive");
  (items[2].props.onClick as () => void)();
  expect(deleteCalls).toEqual([]);
  const dialog = nodes(render()).find((node) => node.type === AlertDialog);
  expect(dialog?.props.open).toBe(true);
});
