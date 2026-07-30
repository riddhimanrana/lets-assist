import { describe, expect, test } from "bun:test";

import {
  OrganizationPluginContextUnavailableError,
  readOrganizationPluginContext,
} from "@/lib/plugins/organization-plugin-context";

describe("organization plugin routing context", () => {
  test("returns a legitimate absent row without inventing an operational error", async () => {
    await expect(
      readOrganizationPluginContext("membership", () => ({
        data: null,
        error: null,
      })),
    ).resolves.toBeNull();
  });

  test("retries transient result errors before returning the row", async () => {
    let attempts = 0;
    const result = await readOrganizationPluginContext(
      "organization",
      () => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? {
                data: null,
                error: {
                  message:
                    "An invalid response was received from the upstream server",
                },
              }
            : {
                data: { id: "fictional-organization" },
                error: null,
              },
        );
      },
    );

    expect(attempts).toBe(2);
    expect(result).toEqual({ id: "fictional-organization" });
  });

  test("wraps exhausted result uncertainty instead of returning a false absence", async () => {
    await expect(
      readOrganizationPluginContext("membership", () => ({
        data: null,
        error: { message: "fetch failed" },
      })),
    ).rejects.toBeInstanceOf(OrganizationPluginContextUnavailableError);
  });

  test("retries and wraps a thrown transport failure", async () => {
    let attempts = 0;

    await expect(
      readOrganizationPluginContext("organization", () => {
        attempts += 1;
        throw new TypeError("fetch failed");
      }),
    ).rejects.toBeInstanceOf(OrganizationPluginContextUnavailableError);
    expect(attempts).toBe(2);
  });
});
