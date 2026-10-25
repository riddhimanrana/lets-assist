import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type QueryResult = { data: unknown; error: unknown };
type Props = Record<string, unknown>;

const CERTIFICATE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const record = {
  id: CERTIFICATE_ID,
  project_title: "Fictional park cleanup",
  creator_name: "Fictional Organizer",
  is_certified: true,
  type: "verified",
  event_start: "2026-10-01T16:00:00.000Z",
  event_end: "2026-10-01T18:00:00.000Z",
  credited_minutes: null,
  check_in_method: "manual",
  organization_name: "Fictional Volunteers",
  project_id: null,
  issued_at: "2026-10-02T00:00:00.000Z",
  volunteer_name: "Fictional Volunteer",
  project_location: "Fictional Park",
  description: null,
  creator_username: "fictional-organizer",
  // Not in the public projection. Present here only to prove it is dropped.
  volunteer_email: "private@example.test",
  user_id: "private-user-id",
};

const state: {
  result: QueryResult;
  thrown: Error | null;
  queries: { table: string; selection: string; filter: unknown[] }[];
  documents: Props[];
  prints: Props[];
} = {
  result: { data: record, error: null },
  thrown: null,
  queries: [],
  documents: [],
  prints: [],
};

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({
    refresh: () => {
      throw new Error("Unexpected automatic refresh");
    },
  }),
}));
mock.module("./_components/CertificateDocument", () => ({
  CertificateDocument: (props: Props) => {
    state.documents.push(props);
    return <div data-stub="certificate-document" />;
  },
}));
mock.module("./_components/PrintCertificate", () => ({
  PrintCertificate: (props: Props) => {
    state.prints.push(props);
    return <div data-stub="print-certificate" />;
  },
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: (selection: string) => ({
        eq: (...filter: unknown[]) => ({
          maybeSingle: async () => {
            state.queries.push({ table, selection, filter });
            if (state.thrown) throw state.thrown;
            return state.result;
          },
          single: async () => {
            throw new Error("The page read must use maybeSingle");
          },
        }),
      }),
    }),
  }),
}));

const { default: VolunteerRecordPage } = await import("./page");

const load = (id = CERTIFICATE_ID) =>
  VolunteerRecordPage({ params: Promise.resolve({ id }) });
const render = async (id = CERTIFICATE_ID) =>
  renderToStaticMarkup(await load(id));

describe("public certificate read errors", () => {
  beforeEach(() => {
    state.result = { data: record, error: null };
    state.thrown = null;
    state.queries = [];
    state.documents = [];
    state.prints = [];
  });

  test("a failed read shows the error and retry instead of a 404", async () => {
    for (const error of [
      { code: "08006", message: "fictional connection failure" },
      { code: "57014", message: "fictional statement timeout" },
      { code: "", message: "TypeError: fictional fetch failed" },
      { code: "PGRST116", message: "fictional result of 2 rows" },
      { code: "PGRST002", message: "fictional schema cache 503" },
    ]) {
      state.result = { data: null, error };

      const html = await render();

      expect(html).toContain('role="alert"');
      expect(html).toContain("We couldn&#x27;t load this certificate");
      expect(html).toContain(">Try again</button>");
      expect(html).not.toContain("certificate-document");
      expect(html).not.toContain("print-certificate");
      expect(html).not.toContain(error.message);
      expect(html).not.toContain(CERTIFICATE_ID);
    }
    expect(state.documents).toEqual([]);
    expect(state.prints).toEqual([]);
  });

  test("the failed-read page is the same for every id and failure", async () => {
    state.result = { data: null, error: { code: "08006", message: "first" } };
    const first = await render(CERTIFICATE_ID);
    state.result = { data: null, error: { code: "57014", message: "second" } };
    const second = await render(OTHER_ID);

    expect(second).toBe(first);
  });

  test("a successful read with no row stays a 404", async () => {
    state.result = { data: null, error: null };

    await expect(load()).rejects.toThrow("not-found");
    expect(state.queries).toHaveLength(1);
  });

  test("a denied read and a malformed id stay a 404", async () => {
    state.result = {
      data: null,
      error: { code: "42501", message: "fictional permission denied" },
    };
    await expect(load()).rejects.toThrow("not-found");

    state.result = {
      data: null,
      error: { code: "22P02", message: "fictional invalid uuid" },
    };
    await expect(load("not-a-certificate-id")).rejects.toThrow("not-found");
  });

  test("a thrown query failure is not reported as a missing certificate", async () => {
    state.thrown = new Error("fictional transport failure");

    await expect(load()).rejects.toThrow("fictional transport failure");
  });

  test("a found certificate renders through the narrow projection only", async () => {
    const html = await render();

    expect(html).toContain("certificate-document");
    expect(html).toContain("print-certificate");
    expect(html).not.toContain('role="alert"');

    expect(state.queries).toHaveLength(1);
    const [{ table, selection, filter }] = state.queries;
    expect(table).toBe("certificate_verification_read_model");
    expect(filter).toEqual(["id", CERTIFICATE_ID]);
    for (const field of ["volunteer_email", "user_id", "signup_id", "*"]) {
      expect(selection).not.toContain(field);
    }

    expect(state.documents).toHaveLength(1);
    expect(state.prints).toHaveLength(1);
    const shown = JSON.stringify([state.documents, state.prints]);
    expect(shown).toContain("Fictional park cleanup");
    expect(shown).not.toContain("private@example.test");
    expect(shown).not.toContain("private-user-id");
  });
});
