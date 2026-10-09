import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RangeBuilder } from "./RangeBuilder";
import { SheetDestinationFields } from "./SheetDestinationFields";
import { SheetSyncConfig } from "./SheetSyncConfig";
import {
  LEGACY_DEFAULT_RANGE_NOTE,
  RANGE_END_EXPLANATION,
} from "./sheet-sync-options";
import type { SheetSyncSetup } from "./useSheetSyncSetup";

const noop = () => {};

const range = {
  columns: ["A", "B", "C"],
  mode: "custom" as const,
  onModeChange: noop,
  startColumn: "A",
  startRow: "1",
  endColumn: "",
  endRow: "",
  onStartColumnChange: noop,
  onStartRowChange: noop,
  onEndColumnChange: noop,
  onEndRowChange: noop,
};

const destination = {
  sheetReportType: "member-hours",
  setSheetReportType: noop,
  sheetTabName: "Member Hours",
  setSheetTabName: noop,
  range,
} as unknown as SheetSyncSetup["destination"];

const escaped = (text: string) => text.replaceAll("'", "&#x27;");

test("the range builder starts with no end and explains what an end does", () => {
  const html = renderToStaticMarkup(<RangeBuilder {...range} />);

  expect(html).toContain("Range: A1<");
  expect(html).not.toContain("H20");
  expect(html).toContain("Range end (optional)");
  expect(html).toContain(escaped(RANGE_END_EXPLANATION));
  expect(html).not.toContain("Remove end");
});

test("a range with an end shows the box and a way to remove it", () => {
  const html = renderToStaticMarkup(
    <RangeBuilder {...range} endColumn="C" endRow="40" />,
  );

  expect(html).toContain("Range: A1:C40<");
  expect(html).toContain("Remove end");
});

function renderConfig(rangeA1: string) {
  const setup = {
    destination,
    layout: {
      reportType: "member-hours",
      layoutConfig: null,
      setLayoutConfig: noop,
      previewRows: null,
      setPreviewRows: noop,
      previewLoading: false,
      handlePreviewReport: noop,
      rangeA1,
      columns: range.columns,
    },
    savingConfig: false,
    handleUpdateSheetConfig: noop,
  } as unknown as SheetSyncSetup;

  return renderToStaticMarkup(
    <SheetSyncConfig
      syncConfig={{
        sheetId: "sheet-1",
        sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1",
        sheetTitle: "Fictional hours",
        tabName: "Member Hours",
        reportType: "member-hours",
        rangeA1,
        autoSync: true,
        syncIntervalMinutes: 1440,
        lastSyncedAt: null,
      }}
      setup={setup}
      sections={["destination"]}
      onSectionsChange={noop}
      connectedBy={null}
      connectedByLabel={null}
      availableOwners={[]}
      loadingOwners={false}
      onOwnerChange={noop}
      settingsDisabled={false}
      onToggleAutoSync={noop}
      onIntervalChange={noop}
      autoSyncWorkerEnabled
    />,
  );
}

test("a sync saved with the old default range says so beside the range", () => {
  expect(LEGACY_DEFAULT_RANGE_NOTE).toBe(
    "This sync was set up with the old default range, so the report is allowed to grow past row 20. Set a range end to keep it inside a box.",
  );
  expect(renderConfig("A1:H20")).toContain(LEGACY_DEFAULT_RANGE_NOTE);
});

test("any other saved range has no legacy note", () => {
  for (const rangeA1 of ["A1", "A1:H21", "B2:D20"]) {
    expect(renderConfig(rangeA1)).not.toContain("old default range");
  }
});

test("the destination fields carry the note between the builder and the footer", () => {
  const html = renderToStaticMarkup(
    <SheetDestinationFields
      idPrefix="fixture"
      destination={destination}
      rangeNote={<p>Fixture note</p>}
      rangeFooter={<p>Fixture footer</p>}
    />,
  );

  expect(html.indexOf("Fixture note")).toBeGreaterThan(
    html.indexOf(escaped(RANGE_END_EXPLANATION)),
  );
  expect(html.indexOf("Fixture footer")).toBeGreaterThan(
    html.indexOf("Fixture note"),
  );
});
