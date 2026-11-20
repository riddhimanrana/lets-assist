import { expect, mock, test } from "bun:test";
import {
  installMinimalDom,
  type MinimalElement,
} from "@/tests/support/minimal-dom";
import { storeImportPreview } from "@/lib/signupgenius/handoff";

const { document } = installMinimalDom();
const rendered: Array<Record<string, unknown>> = [];
mock.module("./ProjectCreator", () => ({
  default: (props: Record<string, unknown>) => {
    rendered.push(props);
    return <div>Editor ready</div>;
  },
}));
mock.module("next/link", () => ({
  default: ({ children }: { children: unknown }) => (
    <span>{children as string}</span>
  ),
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ProjectCreateEntry } = await import("./ProjectCreateEntry");
const id = "11111111-1111-4111-8111-111111111111";
const preview = {
  sourceUrl: "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34",
  title: "Fictional cleanup",
  description: "Bring gloves.",
  location: "Fictional park",
  timezone: "America/Los_Angeles",
  slots: [
    {
      name: "Setup crew",
      date: "2099-10-12",
      startTime: "09:00",
      endTime: "11:00",
      capacity: 6,
    },
  ],
};

test("imported editor keeps the server-validated organization and an explicit saved draft always takes precedence", async () => {
  const values = new Map<string, string>();
  let reads = 0;
  const storage = {
    getItem: (key: string) => {
      reads++;
      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  storeImportPreview(storage, id, preview);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(
      <ProjectCreateEntry
        creationSessionId={id}
        importId={id}
        initialOrgId="validated-org"
      />,
    );
  });
  const draft = rendered.at(-1)?.initialDraftData as {
    basicInfo: { organizationId: string };
  };
  expect(draft.basicInfo.organizationId).toBe("validated-org");
  expect(reads).toBe(1);
  const existing = {
    basicInfo: {
      title: "Existing edited draft",
      description: "Owner edits",
      location: "Other location",
      organizationId: "saved-org",
    },
  };
  await act(async () => {
    root.render(
      <ProjectCreateEntry
        creationSessionId={id}
        importId={id}
        initialDraftId="owned-draft"
        initialDraftData={existing}
      />,
    );
  });
  expect(rendered.at(-1)?.initialDraftData).toBe(existing);
  expect(rendered.at(-1)?.initialDraftId).toBe("owned-draft");
  expect(reads).toBe(1);
  expect((container as unknown as MinimalElement).textContent).toContain(
    "Editor ready",
  );
  await act(async () => root.unmount());
});
