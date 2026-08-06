import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GOOGLE_CALENDAR_APP_CREATED_SCOPE,
  GOOGLE_CALENDAR_LEGACY_FULL_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  hasGoogleCalendarWriteScope,
  hasGoogleDriveFileScope,
  parseGoogleGrantedScopes,
} from "./google-oauth-scopes";

test("parses Google grants as exact whitespace-delimited scope tokens", () => {
  assert.deepEqual(
    [
      ...parseGoogleGrantedScopes(
        `  ${GOOGLE_DRIVE_FILE_SCOPE}\n${GOOGLE_CALENDAR_APP_CREATED_SCOPE}  `,
      ),
    ],
    [GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_CALENDAR_APP_CREATED_SCOPE],
  );
});

test("accepts minimum and legacy Calendar write grants", () => {
  assert.equal(
    hasGoogleCalendarWriteScope(GOOGLE_CALENDAR_APP_CREATED_SCOPE),
    true,
  );
  assert.equal(
    hasGoogleCalendarWriteScope(GOOGLE_CALENDAR_LEGACY_FULL_SCOPE),
    true,
  );
  assert.equal(
    hasGoogleCalendarWriteScope(
      `openid ${GOOGLE_CALENDAR_APP_CREATED_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    ),
    true,
  );
});

test("rejects read-only and substring lookalike Calendar grants", () => {
  assert.equal(
    hasGoogleCalendarWriteScope(
      "https://www.googleapis.com/auth/calendar.readonly",
    ),
    false,
  );
  assert.equal(
    hasGoogleCalendarWriteScope(
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ),
    false,
  );
  assert.equal(
    hasGoogleCalendarWriteScope(
      `${GOOGLE_CALENDAR_APP_CREATED_SCOPE}.readonly`,
    ),
    false,
  );
});

test("matches Drive file grants exactly", () => {
  assert.equal(hasGoogleDriveFileScope(GOOGLE_DRIVE_FILE_SCOPE), true);
  assert.equal(
    hasGoogleDriveFileScope(`${GOOGLE_DRIVE_FILE_SCOPE}.readonly`),
    false,
  );
});

test("connect and callback routes share the exact scope boundary", () => {
  const connectSource = readFileSync(
    `${process.cwd()}/app/api/calendar/google/connect/route.ts`,
    "utf8",
  );
  const callbackSource = readFileSync(
    `${process.cwd()}/app/api/calendar/google/callback/route.ts`,
    "utf8",
  );

  assert.match(connectSource, /GOOGLE_CALENDAR_APP_CREATED_SCOPE/u);
  assert.doesNotMatch(
    connectSource,
    /scopes\.push\("https:\/\/www\.googleapis\.com\/auth\/calendar"\)/u,
  );
  assert.match(callbackSource, /hasGoogleCalendarWriteScope\(grantedScopes\)/u);
  assert.doesNotMatch(callbackSource, /grantedScopes\.includes\("calendar"\)/u);
});
