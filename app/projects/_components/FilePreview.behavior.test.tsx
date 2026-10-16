import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as React from "react";

type Element = React.ReactElement<Record<string, unknown>>;
let state: unknown[] = [];
let dependencies: Array<unknown[] | undefined> = [];
let cursor = 0;
let effects: Array<() => void> = [];

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
  useEffect: (run: () => void, next: unknown[]) => {
    const slot = cursor++;
    const previous = dependencies[slot];
    if (!previous || next.some((value, index) => value !== previous[index])) {
      dependencies[slot] = next;
      effects.push(run);
    }
  },
}));
mock.module("@/lib/safe-console", () => ({
  safeConsole: { error: () => {} },
}));
const { default: FilePreview } = await import("./FilePreview");

const originalGlobals = new Map(
  ["fetch", "document", "window"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
let response: Response;
let rejectFetch = false;
let requestedUrls: string[];
let downloads: Array<{ href: string; download: string }>;
let openedUrls: string[];
let createObjectUrl: ReturnType<typeof spyOn>;
let revokeObjectUrl: ReturnType<typeof spyOn>;

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...elements(value.props.children)];
}

function content(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(content).join(" ");
  if (React.isValidElement<Record<string, unknown>>(value))
    return content(value.props.children);
  return "";
}

const defaultProps = {
  url: "https://files.example.test/project/notes.docx",
  open: true,
  onOpenChange: () => {},
  fileName: "Fictional notes.docx",
  fileType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function render(
  props: Partial<React.ComponentProps<typeof FilePreview>> = {},
  flushEffects = true,
) {
  cursor = 0;
  const tree = FilePreview({ ...defaultProps, ...props });
  if (flushEffects && effects.length) {
    const pendingEffects = effects;
    effects = [];
    pendingEffects.forEach((effect) => effect());
    return render(props, false);
  }
  return tree;
}

function previewElement(tree: unknown) {
  const preview = elements(tree).find(
    ({ props }) => typeof props.onLoad === "function",
  );
  expect(preview).toBeDefined();
  return preview!;
}

async function download(tree: unknown) {
  const button = elements(tree).find(({ props }) => props.title === "Download");
  expect(button).toBeDefined();
  await (button!.props.onClick as () => Promise<void>)();
}

beforeEach(() => {
  state = [];
  dependencies = [];
  cursor = 0;
  effects = [];
  requestedUrls = [];
  downloads = [];
  openedUrls = [];
  rejectFetch = false;
  response = new Response("fictional document", { status: 200 });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (url: string) => {
      requestedUrls.push(url);
      if (rejectFetch) throw new Error("fictional network interruption");
      return response;
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { open: (url: string) => openedUrls.push(url) },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => {
        const link = {
          href: "",
          download: "",
          click: () => downloads.push({ ...link }),
        };
        return link;
      },
    },
  });
  createObjectUrl = spyOn(URL, "createObjectURL").mockReturnValue(
    "blob:fictional-download",
  );
  revokeObjectUrl = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

for (const extension of ["doc", "docx", "txt"]) {
  test(`${extension} shows its download fallback immediately without a loading overlay`, () => {
    const props = {
      url: `https://files.example.test/project/notes.${extension}`,
      fileType: extension === "txt" ? "text/plain" : defaultProps.fileType,
    };
    const initial = render(props, false);
    expect(content(initial)).toContain("Preview not available");
    expect(content(initial)).toContain("Download File");
    expect(content(initial)).not.toContain("Loading preview");
    expect(content(render(props))).not.toContain("Loading preview");
  });
}

test("a failed image replaces loading with a readable error and download action", () => {
  const props = {
    url: "https://files.example.test/project/photo.png",
    fileType: "image/png",
  };
  const initial = render(props);
  expect(content(initial)).toContain("Loading preview");
  (previewElement(initial).props.onError as () => void)();
  const failed = render(props);
  expect(content(failed)).not.toContain("Loading preview");
  expect(content(failed)).toContain("Preview could not load");
  expect(content(failed)).toContain("Download File");
  expect(elements(failed).some(({ props }) => props.role === "alert")).toBe(
    true,
  );
});

test("an HTTP download failure never saves its error body as the document", async () => {
  response = new Response("fictional expired-link error", { status: 403 });
  await download(render());
  expect(requestedUrls).toEqual([defaultProps.url]);
  expect(createObjectUrl).not.toHaveBeenCalled();
  expect(downloads).toEqual([]);
  expect(openedUrls).toEqual([]);
  expect(content(render())).toContain("Download failed");
});

test("a successful download saves and releases the fetched document", async () => {
  await download(render());
  expect(createObjectUrl).toHaveBeenCalledTimes(1);
  expect(downloads).toEqual([
    expect.objectContaining({
      href: "blob:fictional-download",
      download: defaultProps.fileName,
    }),
  ]);
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:fictional-download");
  expect(content(render())).not.toContain("Download failed");
});

test("a signed image URL still previews and settles after its load event", () => {
  const props = {
    url: "https://files.example.test/project/photo.PNG?token=fictional#image",
    fileType: "",
  };
  const initial = render(props);
  expect(content(initial)).toContain("Loading preview");
  expect(previewElement(initial).props.src).toBe(props.url);
  (previewElement(initial).props.onLoad as () => void)();
  const loaded = render(props);
  expect(content(loaded)).not.toContain("Loading preview");
  expect(content(loaded)).not.toContain("Preview not available");
  expect(content(loaded)).not.toContain("Preview could not load");
});

test("a PDF preserves its preview controls and clears loading", () => {
  const props = {
    url: "https://files.example.test/project/waiver.PDF?token=fictional#page=2",
    fileType: "application/pdf",
  };
  const initial = render(props);
  const frame = previewElement(initial);
  expect(frame.type).toBe("iframe");
  expect(frame.props.src).toBe(`${props.url}&toolbar=0&navpanes=0&view=FitH`);
  (frame.props.onLoad as () => void)();
  expect(content(render(props))).not.toContain("Loading preview");
});

test("a PDF-looking query value cannot select a preview for a DOCX path", () => {
  const tree = render({
    url: "https://files.example.test/project/notes.docx?name=waiver.pdf",
  });
  expect(content(tree)).toContain("Preview not available");
  expect(content(tree)).not.toContain("Loading preview");
  expect(elements(tree).some(({ type }) => type === "iframe")).toBe(false);
});

test("a supplied image MIME type previews an opaque storage path", () => {
  const tree = render({
    url: "https://files.example.test/project/fictional-media-id",
    fileType: "image/jpeg",
  });
  expect(content(tree)).toContain("Loading preview");
  expect(previewElement(tree).props.src).toBe(
    "https://files.example.test/project/fictional-media-id",
  );
});

test("opening another file clears a previous image failure", () => {
  const first = {
    url: "https://files.example.test/project/first.png",
    fileType: "image/png",
  };
  (previewElement(render(first)).props.onError as () => void)();
  expect(content(render(first))).toContain("Preview could not load");
  const next = render({
    ...first,
    url: "https://files.example.test/project/next.png",
  });
  expect(content(next)).toContain("Loading preview");
  expect(content(next)).not.toContain("Preview could not load");
});

test("closing and reopening the same image retries its preview", () => {
  const props = {
    url: "https://files.example.test/project/photo.png",
    fileType: "image/png",
  };
  (previewElement(render(props)).props.onError as () => void)();
  expect(content(render(props))).toContain("Preview could not load");
  render({ ...props, open: false });
  expect(content(render(props))).toContain("Loading preview");
  expect(content(render(props))).not.toContain("Preview could not load");
});

test("a network download failure is readable and a later retry succeeds", async () => {
  rejectFetch = true;
  await download(render());
  const failed = render();
  expect(content(failed)).toContain("Download failed");
  expect(elements(failed).some(({ props }) => props.role === "alert")).toBe(
    true,
  );
  expect(downloads).toEqual([]);
  expect(openedUrls).toEqual([]);
  const open = elements(failed).find(
    ({ props }) => props["aria-label"] === "Open in new tab",
  );
  expect(open).toBeDefined();
  expect(String(open!.props.className ?? "").split(" ")).not.toContain(
    "hidden",
  );
  (open!.props.onClick as () => void)();
  expect(openedUrls).toEqual([defaultProps.url]);
  rejectFetch = false;
  await download(failed);
  expect(downloads).toHaveLength(1);
  expect(content(render())).not.toContain("Download failed");
});

test("another document clears the prior download failure", async () => {
  response = new Response("fictional missing file", { status: 404 });
  await download(render());
  expect(content(render())).toContain("Download failed");
  expect(
    content(
      render({ url: "https://files.example.test/project/different.txt" }),
    ),
  ).not.toContain("Download failed");
});

test("dialog dismissal and the explicit open-in-tab action keep their callbacks", () => {
  const onOpenChange = mock(() => {});
  const tree = render({ onOpenChange });
  expect(tree?.props.open).toBe(true);
  (tree!.props.onOpenChange as (value: boolean) => void)(false);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  const open = elements(tree).find(
    ({ props }) => props["aria-label"] === "Open in new tab",
  );
  expect(open).toBeDefined();
  (open!.props.onClick as () => void)();
  expect(openedUrls).toEqual([defaultProps.url]);
  expect(
    elements(tree).some(
      ({ props }) =>
        React.isValidElement<Record<string, unknown>>(props.render) &&
        props.render.props.children === "Close",
    ),
  ).toBe(true);
});

test("a missing document URL renders no preview dialog", () => {
  expect(render({ url: null })).toBeNull();
});
