import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/utils/calendar-helpers", () => ({
  updateCalendarEventForProject: async () => ({
    success: false,
    error: "Unconfirmed",
  }),
}));
const { EditProjectCalendarNotice } =
  await import("./EditProjectCalendarNotice");
afterAll(() => mock.restore());

test("a lost provider acknowledgement is described as unconfirmed, without claiming no write landed", () => {
  const html = renderToStaticMarkup(
    <EditProjectCalendarNotice
      issue={{
        message:
          "Calendar outcome is unconfirmed. Retry to reconcile the same events.",
        retryable: true,
      }}
      retrying={false}
      onRetry={async () => {}}
      onViewProject={() => {}}
    />,
  );
  expect(html).toContain("Project saved");
  expect(html).toContain("unconfirmed");
  expect(html).not.toContain("was not updated");
  expect(html).not.toContain("still shows the earlier details");
});
