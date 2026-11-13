import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationMapCard } from "./LocationMapCard";
for (const location of [
  "Online",
  "Virtual meeting",
  "https://example.test/meeting",
  "",
]) {
  test(`nonphysical location ${location} offers no map action`, () => {
    const html = renderToStaticMarkup(<LocationMapCard location={location} />);
    expect(html).not.toContain("Open in Google Maps");
    expect(html).not.toContain("No location selected");
  });
}
test("text-only addresses offer search without an empty map", () => {
  const html = renderToStaticMarkup(
    <LocationMapCard location="123 Fictional Street" />,
  );
  expect(html).toContain("Open in Google Maps");
  expect(html).not.toContain("No location selected");
});
