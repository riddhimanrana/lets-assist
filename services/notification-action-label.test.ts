import { expect, test } from "bun:test";
import { notificationActionLabel } from "./notification-action-label";

test("CSF actions describe the stored event without looking up private source content", () => {
  for (const [sourceKind, label] of Object.entries({
    post: "View post",
    activity: "View activity",
    point_submission: "View point submission",
    profile: "View My CSF",
  })) {
    expect(notificationActionLabel({ pluginKey: "dvhs-csf", sourceKind })).toBe(
      label,
    );
  }
  expect(notificationActionLabel(null)).toBe("Open link");
  expect(
    notificationActionLabel({ pluginKey: "other", sourceKind: "profile" }),
  ).toBe("Open link");
  expect(
    notificationActionLabel({ pluginKey: "dvhs-csf", sourceKind: "unknown" }),
  ).toBe("Open link");
});
