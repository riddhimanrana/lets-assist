import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

function runProbe(assertions: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--no-env-file",
      "--eval",
      `
    import assert from "node:assert/strict";
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { mock } from "bun:test";
    delete process.env.E2E_TEST_MODE;
    delete process.env.NEXT_PUBLIC_E2E_TEST_MODE;
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const providers = [];
    let inputProps, outboundCalls = 0;
    globalThis.fetch = async () => { outboundCalls++; throw new Error("No provider request allowed."); };
    mock.module("@vis.gl/react-google-maps", () => ({
      APIProvider: (props) => { providers.push({ apiKey: props.apiKey, libraries: props.libraries }); return null; },
      AdvancedMarker: () => null, Map: () => null,
      useApiLoadingStatus: () => "NOT_LOADED", useApiIsLoaded: () => false,
      useMapsLibrary: () => null,
      APILoadingStatus: { FAILED: "FAILED", LOADED: "LOADED" },
      ColorScheme: {}, RenderingType: {}, InfoWindow: () => null,
    }));
    mock.module("./components/ui/input", () => ({ Input: (props) => {
      inputProps = props;
      return React.createElement("input", props);
    } }));
    const { LocationMap } = await import("./components/ui/location-map");
    const { default: LocationAutocomplete } = await import("./components/ui/location-autocomplete");
    const { LocationMapCard } = await import("./app/projects/_components/LocationMapCard");
    const { ProjectsMapView } = await import("./components/projects/ProjectsMapView");
    const render = (component, props = {}) => renderToStaticMarkup(React.createElement(component, props));
    ${assertions}
    assert.equal(outboundCalls, 0);
  `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  expect(result.status).toBe(0);
}

test("missing or blank map keys never mount a provider", () => {
  runProbe(`
    for (const key of [undefined, "", "   "]) {
      if (key === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = key;
      assert.equal(render(LocationMap, { location: { text: "Local venue" } }), "");
      assert.ok(render(ProjectsMapView).includes("Use list view to browse projects."));
      assert.ok(render(LocationAutocomplete, { onChangeAction: () => {} }).includes("<input"));
    }
    assert.deepEqual(providers, []);
  `);
});

test("plain location input preserves accessible fields without inventing coordinates", () => {
  runProbe(`
    const changes = [];
    const html = render(LocationAutocomplete, {
      id: "project-location", value: { text: "Original address", coordinates: { latitude: 40, longitude: -70 } },
      onChangeAction: (value) => changes.push(value), required: true, maxLength: 250,
      error: true, errorMessage: "Enter a location", "aria-invalid": true,
      "aria-errormessage": "location-error",
    });
    assert.ok(html.includes('value="Original address"'));
    assert.ok(html.includes('id="project-location"'));
    assert.ok(html.includes('aria-errormessage="location-error"'));
    assert.ok(html.includes('id="location-error"'));
    assert.equal(inputProps.required, true);
    assert.equal(inputProps.maxLength, 250);
    inputProps.onChange({ target: { value: "New address" } });
    inputProps.onChange({ target: { value: "" } });
    assert.deepEqual(changes, [{ text: "New address", display_name: "New address" }, undefined]);
    assert.deepEqual(providers, []);
  `);
});

test("public location keeps its address and user-controlled directions button", () => {
  runProbe(`
    const html = render(LocationMapCard, { location: "Local community garden" });
    assert.ok(html.includes("Local community garden"));
    assert.ok(html.includes("Open in Google Maps"));
    assert.ok(html.includes("Open Local community garden in Google Maps"));
    assert.ok(!html.includes("Loading map"));
    assert.deepEqual(providers, []);
  `);
});

test("configured maps retain their provider and Places library boundaries", () => {
  runProbe(`
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = " configured-for-unit-test ";
    render(LocationMap);
    render(LocationAutocomplete, { onChangeAction: () => {} });
    render(ProjectsMapView);
    assert.deepEqual(providers, [
      { apiKey: "configured-for-unit-test", libraries: ["places"] },
      { apiKey: "configured-for-unit-test", libraries: ["places"] },
      { apiKey: "configured-for-unit-test", libraries: undefined },
    ]);
  `);
});
