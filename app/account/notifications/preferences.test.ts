import { expect, test } from "bun:test";
import {
  notificationPreferencesChanged,
  readNotificationPreferences,
} from "./preferences";

test("settings edits retain opt-outs and exclude row identity fields", () => {
  expect(
    readNotificationPreferences({
      user_id: "fictional-user",
      id: "fictional-settings",
      email_notifications: false,
      project_updates: false,
      organization_updates: false,
      general: false,
    }),
  ).toEqual({
    email_notifications: false,
    project_updates: false,
    organization_updates: false,
    general: false,
  });
});

test("organization and general opt-outs can each enable Save changes", () => {
  const original = readNotificationPreferences({
    email_notifications: true,
    project_updates: true,
    general: true,
  });
  expect(original.organization_updates).toBe(true);
  expect(notificationPreferencesChanged(original, { ...original })).toBe(false);
  expect(
    notificationPreferencesChanged(original, {
      ...original,
      organization_updates: false,
    }),
  ).toBe(true);
  expect(
    notificationPreferencesChanged(original, { ...original, general: false }),
  ).toBe(true);
  expect(notificationPreferencesChanged(null, original)).toBe(false);
  expect(notificationPreferencesChanged(original, null)).toBe(false);
});

test("an account without saved preferences can choose its first opt-out", () => {
  const initial = readNotificationPreferences({});
  expect(initial).toEqual({
    email_notifications: true,
    project_updates: true,
    organization_updates: true,
    general: true,
  });
  expect(
    notificationPreferencesChanged(initial, {
      ...initial,
      email_notifications: false,
    }),
  ).toBe(true);
});
