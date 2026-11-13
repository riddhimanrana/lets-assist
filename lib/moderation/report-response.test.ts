import { expect, test } from "bun:test";
import { readContentReportResponse } from "./report-response";

test("a proxy auth outage remains actionable when it returns plain text", async () => {
  await expect(
    readContentReportResponse(
      new Response("Authentication temporarily unavailable", { status: 503 }),
    ),
  ).rejects.toThrow("Your description is still here");
});
test("a login page or malformed success is never a confirmed report", async () => {
  await expect(
    readContentReportResponse(new Response("<html>Sign in</html>")),
  ).rejects.toThrow("could not be confirmed");
  await expect(readContentReportResponse(Response.json({}))).rejects.toThrow(
    "could not be confirmed",
  );
});
test("only an explicit successful receipt clears the form", async () => {
  await expect(
    readContentReportResponse(Response.json({ success: true })),
  ).resolves.toBeUndefined();
});
