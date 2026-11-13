import { expect, test } from "bun:test";
import { parseCertificateFiles } from "./csv-files";
const csv =
  "Certificate ID,Project Title,Organization Name,Project Organizer Name,Certification Status,Certificate Type,Event Start Date,Event End Date,Duration,Location,Check In Method,Volunteer Name,Volunteer Email,Issued Date\naaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,Park cleanup,Helpers,Sam,Verified,verified,2026-11-09,2026-11-09,8,Park,manual,Alex,alex@example.test,2026-11-10";
test("rejects identical CSV content under different names", async () => {
  await expect(
    parseCertificateFiles([
      new File([csv], "one.csv"),
      new File([csv], "renamed.csv"),
    ]),
  ).rejects.toThrow("already included");
});
test("combines different CSV files before certificate-ID verification", async () => {
  const rows = await parseCertificateFiles([
    new File([csv], "one.csv"),
    new File([csv.replaceAll("aaaaaaaa", "bbbbbbbb")], "two.csv"),
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0].certificateId).not.toEqual(rows[1].certificateId);
});
test("bounds selected file count", async () => {
  await expect(
    parseCertificateFiles(
      Array.from({ length: 21 }, (_, i) => new File([csv], `${i}.csv`)),
    ),
  ).rejects.toThrow("20");
});
