import type { EventFormState } from "@/hooks/use-event-form";

type DraftData = Partial<EventFormState>;
type SaveResult = { id?: string; error?: string; autosaved?: boolean };
type DeleteResult = { error?: string };

type DraftActions = {
  save: (data: DraftData, id?: string) => Promise<SaveResult>;
  copy: (data: DraftData) => Promise<SaveResult>;
  remove: (id: string) => Promise<DeleteResult>;
};

// Serialize draft writes so publication cannot delete a draft before its first
// autosave finishes, and a saved copy becomes the target of subsequent edits.
export function createProjectDraftSession(
  initialId: string | undefined,
  actions: DraftActions,
) {
  let id = initialId;
  let published = false;
  let publishing = false;
  let pending: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }

  function save(data: DraftData, copy: boolean): Promise<SaveResult> {
    if (published || publishing) {
      return Promise.resolve({
        error: "This project is being published or has already been published.",
      });
    }
    return enqueue(async () => {
      const result = copy
        ? await actions.copy(data)
        : await actions.save(data, id);
      if (!result.error && result.id) id = result.id;
      return result;
    });
  }

  return {
    get id() {
      return id;
    },
    get publishing() {
      return publishing;
    },
    save: (data: DraftData) => save(data, false),
    copy: (data: DraftData) => save(data, true),
    beginPublication: () => {
      if (publishing || published)
        return Promise.reject(
          new Error("Project publication is already in progress"),
        );
      publishing = true;
      return pending;
    },
    endPublication: () => {
      publishing = false;
    },
    consume: () => {
      published = true;
      return enqueue(async () => {
        if (!id) return {};
        const result = await actions.remove(id);
        if (!result.error) id = undefined;
        return result;
      });
    },
  };
}
