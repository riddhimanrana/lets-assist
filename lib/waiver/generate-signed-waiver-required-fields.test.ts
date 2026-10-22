import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { generateSignedWaiverPdf } from "./generate-signed-waiver-pdf";

const rect = { x: 100, y: 200, width: 200, height: 50 };
const signaturePayload = {
  signers: [
    {
      role_key: "participant",
      method: "typed" as const,
      data: "Fictional Volunteer",
      timestamp: "2026-10-11T12:00:00Z",
    },
  ],
  fields: { name: "Fictional Volunteer" },
};
const definition = (nameRequired: boolean, nameRole = "participant") => ({
  id: "immutable-historical-definition",
  signers: [
    { role_key: "participant", required: true },
    { role_key: "optional", required: false },
  ],
  fields: [
    {
      field_key: "signature",
      field_type: "signature",
      signer_role_key: "participant",
      page_index: 0,
      rect,
      required: true,
    },
    {
      field_key: "name",
      field_type: "name",
      signer_role_key: nameRole,
      page_index: 9,
      rect,
      required: nameRequired,
    },
  ],
});
async function source() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  return pdf.save();
}
test("historical required signer name on a missing page cannot silently disappear from a successful PDF", async () => {
  await expect(
    generateSignedWaiverPdf({
      sourcePdfBytes: await source(),
      definition: definition(true),
      signaturePayload,
    }),
  ).rejects.toMatchObject({ code: "unplaceable_signature" });
});
test("an unrelated unsigned optional signer field retains the established skipping behavior", async () => {
  const bytes = await generateSignedWaiverPdf({
    sourcePdfBytes: await source(),
    definition: definition(true, "optional"),
    signaturePayload,
  });
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});
