import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as React from "react";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER = { id: "22222222-2222-4222-8222-222222222222" };
const STRANGER = { id: "33333333-3333-4333-8333-333333333333" };
const PDF = "application/pdf";

type ProjectRow = {
  id: string;
  creator_id: string;
  organization_id: string | null;
  cover_image_url: string | null;
  /** jsonb. `null` here is SQL NULL. */
  documents: Array<Record<string, unknown>> | null;
};

let actor: { id: string } | null = OWNER;
let project: ProjectRow;
/** Row writes, in order, including ones the database did not apply. */
let writes: Array<Record<string, unknown>> = [];
/** How many of the next writes match the row, report success and change nothing. */
let ignoredWrites = 0;
/** How many of the next writes wait, already sent, until a test releases them. */
let writesToHold = 0;
/** Releases for the waiting writes, in the order the writes were sent. */
let heldWrites: Array<() => void> = [];
/** Another request committing just before each write reaches the row. */
let beforeWrite: (() => void) | null = null;
/** How many of the next link answers never reach the browser. */
let lostLinkAnswers = 0;
const objects = new Map<string, string>();
let uploadAttempts: string[] = [];
let failingUploads = new Set<string>();
let removals: string[] = [];

/** jsonb `=`: arrays compare in order, object keys in any order. */
function jsonbEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonbEqual(item, right[index]))
    );
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && jsonbEqual(a[key], b[key]))
    );
  }
  return left === right;
}

function serverClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: actor }, error: null }),
    },
    from(table: string) {
      let payload: Record<string, unknown> | null = null;
      let filterError: { code: string; message: string } | null = null;
      // Filters run against the row as it is when the statement executes, not
      // as it was when the request was built.
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const matches = () =>
        table === "projects" &&
        filters.every((filter) => filter(project as Record<string, unknown>));
      const row = () => (matches() ? structuredClone(project) : null);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        if (table !== "projects") return chain;
        if (column !== "documents") {
          filters.push((candidate) => candidate[column] === value);
          return chain;
        }
        // PostgREST reads the filter as text and casts it to jsonb. Text that
        // is not JSON fails the request. NULL = anything is not true.
        let expected: unknown;
        try {
          expected = JSON.parse(String(value));
        } catch {
          filterError = {
            code: "22P02",
            message: "invalid input syntax for type json",
          };
          return chain;
        }
        filters.push(
          (candidate) =>
            candidate.documents !== null &&
            jsonbEqual(candidate.documents, expected),
        );
        return chain;
      };
      chain.is = (column: string, value: unknown) => {
        if (table === "projects")
          filters.push(
            (candidate) => value === null && candidate[column] === null,
          );
        return chain;
      };
      chain.update = (next: Record<string, unknown>) => {
        payload = next;
        return chain;
      };
      chain.single = async () => {
        const data = row();
        return { data, error: data ? null : { code: "PGRST116" } };
      };
      chain.maybeSingle = async () => ({ data: null, error: null });
      const execute = async () => {
        if (filterError) return { data: null, error: filterError };
        if (table !== "projects" || !payload)
          return { data: null, error: null };
        if (writesToHold > 0) {
          writesToHold -= 1;
          await new Promise<void>((release) => heldWrites.push(release));
        }
        beforeWrite?.();
        writes.push(payload);
        // An update that matches no row still succeeds, and changes nothing.
        if (matches()) {
          if (ignoredWrites > 0) ignoredWrites -= 1;
          else Object.assign(project, structuredClone(payload));
        }
        return { data: null, error: null };
      };
      chain.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => execute().then(onFulfilled, onRejected);
      return chain;
    },
  };
}

/** Waits until this many writes have been sent and are waiting. */
async function writesHeld(count: number) {
  for (let turn = 0; heldWrites.length < count; turn += 1) {
    if (turn === 200) {
      throw new Error(
        `Only ${heldWrites.length} of ${count} writes were sent.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function browserClient() {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: File) => {
          uploadAttempts.push(file.name);
          if (failingUploads.delete(file.name)) {
            return {
              data: null,
              error: { message: "fictional network interruption" },
            };
          }
          const key = `${bucket}/${path}`;
          if (objects.has(key)) {
            return {
              data: null,
              error: {
                statusCode: "409",
                error: "Duplicate",
                message: "The resource already exists",
              },
            };
          }
          objects.set(key, await file.text());
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://storage.example.test/object/public/${bucket}/${path}`,
          },
        }),
        remove: async (paths: string[]) => {
          for (const path of paths) {
            removals.push(`${bucket}/${path}`);
            objects.delete(`${bucket}/${path}`);
          }
          return { data: [], error: null };
        },
      }),
    },
  };
}

let state: unknown[] = [];
let cursor = 0;

// The repository runner gives module-mocking suites their own Bun process.
mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in state))
      state[slot] = typeof initial === "function" ? initial() : initial;
    return [
      state[slot],
      (next: unknown) => {
        state[slot] = typeof next === "function" ? next(state[slot]) : next;
      },
    ];
  },
}));
mock.module("sonner", () => ({ toast: { error: () => {} } }));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { error: () => {}, warn: () => {}, log: () => {} },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => serverClient(),
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => browserClient(),
}));

// The hook reaches the real link action. Only its answer can be dropped.
const { linkProjectUploadedAssets } = await import("./server/assets");
mock.module("./actions", () => ({
  linkProjectUploadedAssets: async (
    ...args: Parameters<typeof linkProjectUploadedAssets>
  ) => {
    const result = await linkProjectUploadedAssets(...args);
    if (lostLinkAnswers > 0) {
      lostLinkAnswers -= 1;
      throw new Error("fictional lost response");
    }
    return result;
  },
}));
const { useProjectFileUploads } = await import("./use-project-file-uploads");

function render() {
  cursor = 0;
  return useProjectFileUploads();
}

function pick(documents: File[], coverImage: File | null = null) {
  const hook = render();
  hook.setDocuments(documents);
  hook.setCoverImage(coverImage);
}

/** A reload: the hook starts empty and the same files are chosen again. */
function reloadAndPick(documents: File[], coverImage: File | null = null) {
  state = [];
  pick(documents, coverImage);
}

const upload = () => render().uploadProjectFiles(PROJECT_ID);

function statusOf(file: File) {
  const hook = render();
  return hook.documentUploadStates[hook.getUploadKey(file)];
}

function pdf(name: string, text: string) {
  return new File([text], name, { type: PDF, lastModified: 1 });
}

const attachedNames = () =>
  (project.documents ?? []).map((document) => document.name);
const attachedUrls = () =>
  (project.documents ?? []).map((document) => document.url);
const attemptsFor = (name: string) =>
  uploadAttempts.filter((attempt) => attempt === name).length;

/** A document already in storage, as the browser sends it to the link action. */
const uploaded = (name: string, type = PDF) => ({
  name,
  originalName: name,
  type,
  size: 10,
  url: `https://storage.example.test/object/public/project-documents/project_${PROJECT_ID}_${name}`,
});

beforeEach(() => {
  actor = OWNER;
  project = {
    id: PROJECT_ID,
    creator_id: OWNER.id,
    organization_id: null,
    cover_image_url: null,
    documents: [],
  };
  writes = [];
  ignoredWrites = 0;
  writesToHold = 0;
  heldWrites = [];
  beforeWrite = null;
  lostLinkAnswers = 0;
  objects.clear();
  uploadAttempts = [];
  failingUploads = new Set();
  removals = [];
  state = [];
  cursor = 0;
});

describe("retrying a partly successful upload", () => {
  test("only the document that failed is sent and attached on the retry", async () => {
    const first = pdf("first.pdf", "fictional first");
    const second = pdf("second.pdf", "fictional second");
    const cover = new File(["fictional cover"], "cover.png", {
      type: "image/png",
      lastModified: 1,
    });
    pick([first, second], cover);
    failingUploads.add("second.pdf");

    expect(await upload()).toEqual({ hasErrors: true });
    expect(attachedNames()).toEqual(["first.pdf"]);
    expect(statusOf(first)).toBe("done");
    expect(statusOf(second)).toBe("error");
    const coverUrl = project.cover_image_url;
    expect(coverUrl).toContain(`/project-images/project_${PROJECT_ID}_cover_`);

    expect(await upload()).toEqual({ hasErrors: false });
    expect(attachedNames()).toEqual(["first.pdf", "second.pdf"]);
    expect(project.cover_image_url).toBe(coverUrl);
    expect(attemptsFor("first.pdf")).toBe(1);
    expect(attemptsFor("cover.png")).toBe(1);
    expect(attemptsFor("second.pdf")).toBe(2);
    expect(statusOf(first)).toBe("done");
    expect(statusOf(second)).toBe("done");
    expect(render().coverImageUploadState).toBe("done");
    expect(objects.size).toBe(3);
    expect(removals).toEqual([]);
  });

  test("the same files chosen again after a reload are neither stored nor attached twice", async () => {
    pick([
      pdf("first.pdf", "fictional first"),
      pdf("second.pdf", "fictional second"),
    ]);
    failingUploads.add("second.pdf");
    expect(await upload()).toEqual({ hasErrors: true });
    const firstUrl = attachedUrls()[0];

    reloadAndPick([
      pdf("first.pdf", "fictional first"),
      pdf("second.pdf", "fictional second"),
    ]);
    expect(await upload()).toEqual({ hasErrors: false });

    expect(attachedNames()).toEqual(["first.pdf", "second.pdf"]);
    expect(attachedUrls()[0]).toBe(firstUrl);
    expect(objects.size).toBe(2);
    expect(removals).toEqual([]);
  });

  test("a third attempt after everything is attached changes nothing", async () => {
    pick([pdf("first.pdf", "fictional first")]);
    expect(await upload()).toEqual({ hasErrors: false });
    const writesAfterFirst = writes.length;

    expect(await upload()).toEqual({ hasErrors: false });
    reloadAndPick([pdf("first.pdf", "fictional first")]);
    expect(await upload()).toEqual({ hasErrors: false });

    expect(attachedNames()).toEqual(["first.pdf"]);
    expect(writes).toHaveLength(writesAfterFirst);
    expect(objects.size).toBe(1);
  });
});

describe("an ordinary upload", () => {
  test("two documents are appended after the ones the project already has", async () => {
    const existing = {
      name: "earlier.pdf",
      originalName: "earlier.pdf",
      type: PDF,
      size: 12,
      url: "https://storage.example.test/object/public/project-documents/earlier.pdf",
    };
    project.documents = [existing];
    const guide = pdf("guide.pdf", "fictional guide");
    const map = new File(["fictional map"], "map.png", {
      type: "image/png",
      lastModified: 1,
    });
    pick([guide, map]);

    expect(await upload()).toEqual({ hasErrors: false });

    expect(project.documents).toEqual([
      existing,
      {
        name: "guide.pdf",
        originalName: "guide.pdf",
        type: PDF,
        size: guide.size,
        url: expect.stringMatching(
          new RegExp(
            `/project-documents/project_${PROJECT_ID}_[0-9a-f]{32}\\.pdf$`,
            "u",
          ),
        ),
      },
      {
        name: "map.png",
        originalName: "map.png",
        type: "image/png",
        size: map.size,
        url: expect.stringMatching(
          new RegExp(
            `/project-documents/project_${PROJECT_ID}_[0-9a-f]{32}\\.png$`,
            "u",
          ),
        ),
      },
    ]);
    expect(statusOf(guide)).toBe("done");
    expect(statusOf(map)).toBe("done");
    expect(writes).toHaveLength(1);
  });

  test("a changed file with the same name is stored and attached as its own document", async () => {
    pick([pdf("first.pdf", "fictional draft A")]);
    expect(await upload()).toEqual({ hasErrors: false });

    // Same name, size and modified time. Only the bytes differ.
    reloadAndPick([pdf("first.pdf", "fictional draft B")]);
    expect(await upload()).toEqual({ hasErrors: false });

    expect(attachedNames()).toEqual(["first.pdf", "first.pdf"]);
    expect(new Set(attachedUrls()).size).toBe(2);
    expect([...objects.values()].sort()).toEqual([
      "fictional draft A",
      "fictional draft B",
    ]);
    expect(removals).toEqual([]);
  });

  test("a document over the size limit is never sent, and the rest are attached", async () => {
    const large = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "large.pdf",
      {
        type: PDF,
        lastModified: 1,
      },
    );
    const small = pdf("small.pdf", "fictional small");
    pick([large, small]);

    expect(await upload()).toEqual({ hasErrors: true });

    expect(uploadAttempts).toEqual(["small.pdf"]);
    expect(attachedNames()).toEqual(["small.pdf"]);
    expect(statusOf(large)).toBe("error");
  });
});

describe("a link that is not confirmed", () => {
  test("a lost answer removes nothing, and the retry leaves each document attached once", async () => {
    const first = pdf("first.pdf", "fictional first");
    const second = pdf("second.pdf", "fictional second");
    pick([first, second]);
    lostLinkAnswers = 1;

    await expect(upload()).rejects.toThrow("fictional lost response");
    // The server did attach them. The browser cannot know that.
    expect(attachedNames()).toEqual(["first.pdf", "second.pdf"]);
    expect(statusOf(first)).toBe("error");
    expect(objects.size).toBe(2);
    expect(removals).toEqual([]);

    expect(await upload()).toEqual({ hasErrors: false });
    expect(attachedNames()).toEqual(["first.pdf", "second.pdf"]);
    expect(statusOf(first)).toBe("done");
    expect(statusOf(second)).toBe("done");
    expect(objects.size).toBe(2);
    expect(removals).toEqual([]);
  });

  test("a write that changes nothing is reported as a failure and can be retried", async () => {
    const first = pdf("first.pdf", "fictional first");
    pick([first]);
    ignoredWrites = 3;

    expect(await upload()).toEqual({ hasErrors: true });
    expect(attachedNames()).toEqual([]);
    expect(statusOf(first)).toBe("error");
    expect(writes).toHaveLength(3);
    expect(removals).toEqual([]);

    expect(await upload()).toEqual({ hasErrors: false });
    expect(attachedNames()).toEqual(["first.pdf"]);
    expect(attemptsFor("first.pdf")).toBe(2);
    expect(objects.size).toBe(1);
  });

  test("a write another request overwrote is applied once more", async () => {
    pick([pdf("first.pdf", "fictional first")]);
    ignoredWrites = 1;

    expect(await upload()).toEqual({ hasErrors: false });
    expect(attachedNames()).toEqual(["first.pdf"]);
    expect(writes).toHaveLength(2);
  });

  test("a document list that changes before every write fails, keeps the stored file, and can be retried", async () => {
    const first = pdf("first.pdf", "fictional first");
    pick([first]);
    let others = 0;
    beforeWrite = () => {
      others += 1;
      project.documents = [
        ...(project.documents ?? []),
        uploaded(`other-${others}.pdf`),
      ];
    };

    expect(await upload()).toEqual({ hasErrors: true });
    // Every document the other requests attached is still there.
    expect(attachedNames()).toEqual([
      "other-1.pdf",
      "other-2.pdf",
      "other-3.pdf",
    ]);
    expect(statusOf(first)).toBe("error");
    expect(objects.size).toBe(1);
    expect(removals).toEqual([]);

    beforeWrite = null;
    expect(await upload()).toEqual({ hasErrors: false });
    expect(attachedNames()).toEqual([
      "other-1.pdf",
      "other-2.pdf",
      "other-3.pdf",
      "first.pdf",
    ]);
    expect(statusOf(first)).toBe("done");
    expect(objects.size).toBe(1);
    expect(removals).toEqual([]);
  });
});

describe("two link requests that read the same documents", () => {
  const earlier = uploaded("earlier.pdf");
  const startingRows: Array<[string, ProjectRow["documents"]]> = [
    ["a row that already has a document", [earlier]],
    ["a row with an empty list", []],
    ["a row whose documents are SQL NULL", null],
  ];

  for (const [label, starting] of startingRows) {
    test(`${label} keeps both appends when the later write lands second`, async () => {
      project.documents = structuredClone(starting);
      writesToHold = 2;

      const slow = linkProjectUploadedAssets(PROJECT_ID, {
        documents: [uploaded("slow.pdf")],
      });
      await writesHeld(1);
      const fast = linkProjectUploadedAssets(PROJECT_ID, {
        documents: [uploaded("fast.pdf")],
      });
      await writesHeld(2);
      // Both requests have read the row and sent a write. Neither has landed.
      expect(project.documents).toEqual(starting);

      heldWrites[1]();
      expect(await fast).toEqual({ success: true });
      expect(project.documents).toEqual([
        ...(starting ?? []),
        uploaded("fast.pdf"),
      ]);

      heldWrites[0]();
      expect(await slow).toEqual({ success: true });
      expect(project.documents).toEqual([
        ...(starting ?? []),
        uploaded("fast.pdf"),
        uploaded("slow.pdf"),
      ]);
    });
  }

  test("a request that loses to another carrying the same stored file attaches it once", async () => {
    project.documents = [earlier];
    writesToHold = 2;

    const slow = linkProjectUploadedAssets(PROJECT_ID, {
      documents: [uploaded("shared.pdf"), uploaded("slow.pdf")],
    });
    await writesHeld(1);
    const fast = linkProjectUploadedAssets(PROJECT_ID, {
      documents: [uploaded("shared.pdf")],
    });
    await writesHeld(2);

    heldWrites[1]();
    expect(await fast).toEqual({ success: true });
    heldWrites[0]();
    expect(await slow).toEqual({ success: true });

    expect(attachedNames()).toEqual(["earlier.pdf", "shared.pdf", "slow.pdf"]);
  });

  test("a cover and a document sent together both land after losing once", async () => {
    project.documents = [earlier];
    writesToHold = 2;

    const slow = linkProjectUploadedAssets(PROJECT_ID, {
      coverImageUrl: "https://storage.example.test/cover.png",
      documents: [uploaded("slow.pdf")],
    });
    await writesHeld(1);
    const fast = linkProjectUploadedAssets(PROJECT_ID, {
      documents: [uploaded("fast.pdf")],
    });
    await writesHeld(2);

    heldWrites[1]();
    expect(await fast).toEqual({ success: true });
    heldWrites[0]();
    expect(await slow).toEqual({ success: true });

    expect(project.cover_image_url).toBe(
      "https://storage.example.test/cover.png",
    );
    expect(attachedNames()).toEqual(["earlier.pdf", "fast.pdf", "slow.pdf"]);
  });

  test("a cover-only request leaves a document attached while it waited", async () => {
    project.documents = [earlier];
    writesToHold = 1;

    const cover = linkProjectUploadedAssets(PROJECT_ID, {
      coverImageUrl: "https://storage.example.test/cover.png",
    });
    await writesHeld(1);
    expect(
      await linkProjectUploadedAssets(PROJECT_ID, {
        documents: [uploaded("guide.pdf")],
      }),
    ).toEqual({ success: true });

    heldWrites[0]();
    expect(await cover).toEqual({ success: true });

    expect(project.cover_image_url).toBe(
      "https://storage.example.test/cover.png",
    );
    expect(attachedNames()).toEqual(["earlier.pdf", "guide.pdf"]);
    // The cover write is not tied to the documents, so it lands first time.
    expect(writes).toHaveLength(2);
  });

  test("a request that loses every time reports the retry message and overwrites nothing", async () => {
    project.documents = [earlier];
    let others = 0;
    beforeWrite = () => {
      others += 1;
      project.documents = [
        ...(project.documents ?? []),
        uploaded(`other-${others}.pdf`),
      ];
    };

    const result = await linkProjectUploadedAssets(PROJECT_ID, {
      coverImageUrl: "https://storage.example.test/cover.png",
      documents: [uploaded("mine.pdf")],
    });

    expect(result).toEqual({
      error: "Uploaded files could not be attached to the project.",
    });
    expect(attachedNames()).toEqual([
      "earlier.pdf",
      "other-1.pdf",
      "other-2.pdf",
      "other-3.pdf",
    ]);
    expect(project.cover_image_url).toBeNull();
  });
});

describe("the link action keeps its checks", () => {
  const document = uploaded;

  test("someone who cannot manage the project attaches nothing", async () => {
    actor = STRANGER;
    const refused = await linkProjectUploadedAssets(PROJECT_ID, {
      documents: [document("guide.pdf")],
    });
    expect(refused).toEqual({
      error: "You don't have permission to update this project.",
    });

    actor = null;
    const signedOut = await linkProjectUploadedAssets(PROJECT_ID, {
      coverImageUrl: "https://storage.example.test/cover.png",
    });
    expect(signedOut).toEqual({
      error: "You must be logged in to upload files.",
    });

    expect(project.documents).toEqual([]);
    expect(project.cover_image_url).toBeNull();
    expect(writes).toEqual([]);
  });

  test("a type that is not allowed is left out and the allowed one is attached", async () => {
    const result = await linkProjectUploadedAssets(PROJECT_ID, {
      documents: [
        document("tool.exe", "application/x-msdownload"),
        document("notes.txt", "text/plain"),
      ],
    });

    expect(result).toEqual({ success: true });
    expect(attachedNames()).toEqual(["notes.txt"]);
  });

  test("one stored file listed twice in a request is attached once", async () => {
    const result = await linkProjectUploadedAssets(PROJECT_ID, {
      documents: [document("guide.pdf"), document("guide.pdf")],
    });

    expect(result).toEqual({ success: true });
    expect(attachedNames()).toEqual(["guide.pdf"]);
  });
});
