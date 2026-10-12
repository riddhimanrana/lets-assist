// Explicit pure offline checks. No scratch files, actors, SDK calls or sockets.
import assert from "node:assert/strict";
import vm from "node:vm";
export function runProfileDiagnosticChecks(effects, captureSource) {
  let checks = 0;
  const pass = (fn) => {
      fn();
      checks++;
    },
    deny = (fn) => {
      assert.throws(fn);
      checks++;
    };
  // Refusal diagnosis uses finite literals and cannot turn a denied frame into
  // permitted traffic. No real actor, session or WebSocket is involved.
  const diagnosticActor = {
      kind: "baseline",
      id: "10000000-0000-4000-8000-000000000001",
    },
    diagnosticToken = "OFFLINE_TOKEN_MUST_NOT_LEAK",
    diagnosticTopic =
      "realtime:profile-updates-20000000-0000-4000-8000-000000000001-" +
      diagnosticActor.id,
    diagnosticJoin = [
      "1",
      "1",
      diagnosticTopic,
      "phx_join",
      {
        access_token: diagnosticToken,
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: "", enabled: false },
          private: false,
          postgres_changes: [
            {
              event: "*",
              schema: "public",
              table: "profiles",
              filter: "id=eq." + diagnosticActor.id,
            },
          ],
        },
      },
    ];
  const frameDiagnostic = (frame) =>
    effects.profileReaderDiagnostic(frame, diagnosticActor, diagnosticToken);
  pass(() =>
    assert.deepEqual(frameDiagnostic(JSON.stringify(diagnosticJoin)), {
      phase: "frame",
      event: "phx_join",
      reason: "accepted",
    }),
  );
  for (const event of ["access_token", "phx_leave", "broadcast", "presence"]) {
    const frame = JSON.stringify([
      "1",
      "2",
      diagnosticTopic,
      event,
      event === "access_token" ? { access_token: diagnosticToken } : {},
    ]);
    deny(() =>
      effects.profileReaderFrame(frame, diagnosticActor, diagnosticToken),
    );
    pass(() =>
      assert.deepEqual(frameDiagnostic(frame), {
        phase: "frame",
        event,
        reason: "event-or-channel",
      }),
    );
    pass(() => {
      const encoded = JSON.stringify(frameDiagnostic(frame));
      for (const secret of [
        diagnosticToken,
        diagnosticTopic,
        diagnosticActor.id,
      ])
        assert(!encoded.includes(secret));
    });
  }
  for (const [alter, reason] of [
    [
      (v) => {
        v[4].access_token = "OFFLINE_FOREIGN_TOKEN";
      },
      "nonce-or-token",
    ],
    [
      (v) => {
        v[4].config.presence.enabled = true;
      },
      "configuration",
    ],
    [
      (v) => {
        v[4].config.postgres_changes[0].table = "OFFLINE_PRIVATE_TABLE";
      },
      "profile-filter",
    ],
    [
      (v) => {
        v[3] = "OFFLINE_PRIVATE_EVENT";
      },
      "event-or-channel",
    ],
    [
      (v) => {
        v[2] = "OFFLINE_PRIVATE_TOPIC";
      },
      "event-or-channel",
    ],
  ]) {
    const value = structuredClone(diagnosticJoin);
    alter(value);
    const frame = JSON.stringify(value);
    deny(() =>
      effects.profileReaderFrame(frame, diagnosticActor, diagnosticToken),
    );
    pass(() => {
      const d = frameDiagnostic(frame),
        encoded = JSON.stringify(d);
      assert.equal(d.reason, reason);
      assert(
        !encoded.includes("OFFLINE_PRIVATE") &&
          !encoded.includes("OFFLINE_FOREIGN_TOKEN") &&
          !encoded.includes(diagnosticActor.id) &&
          !encoded.includes(diagnosticToken),
      );
    });
  }
  for (const [frame, reason] of [
    ["OFFLINE_PRIVATE_BROKEN_JSON", "json"],
    ["X".repeat(8193), "type-or-size"],
    [Buffer.from("OFFLINE_PRIVATE_BINARY"), "type-or-size"],
    [
      JSON.stringify({
        topic: diagnosticTopic,
        event: "OFFLINE_PRIVATE_EVENT",
      }),
      "envelope",
    ],
  ])
    pass(() =>
      assert.deepEqual(frameDiagnostic(frame), {
        phase: "frame",
        event: "other",
        reason,
      }),
    );
  pass(() =>
    assert.deepEqual(
      frameDiagnostic(JSON.stringify([null, "2", "phoenix", "heartbeat", {}])),
      { phase: "frame", event: "heartbeat", reason: "accepted" },
    ),
  );
  pass(() =>
    assert.equal(
      effects.profileReaderDiagnostic(
        JSON.stringify(diagnosticJoin),
        null,
        diagnosticToken,
      ).reason,
      "actor-or-token",
    ),
  );

  const snapshotStart = captureSource.indexOf(
      "capture.dom = await page.evaluate(() => {",
    ),
    keyboardStart = captureSource.indexOf("capture.keyboard = []"),
    restingStart = captureSource.indexOf(
      "capture.restingState = await restoreCaptureRestingState(page)",
    ),
    screenshotStart = captureSource.indexOf(
      "const pixels = await page.screenshot(",
    );
  pass(() =>
    assert(
      restingStart > keyboardStart &&
        snapshotStart > restingStart &&
        snapshotStart < screenshotStart,
    ),
  );
  const marker = (
    skeleton,
    busy,
    region,
    hidden = false,
    cssHidden = false,
  ) => ({
    getClientRects: () => (cssHidden ? [] : [{}]),
    matches: (selector) =>
      selector === '[data-slot="skeleton"]' ? skeleton : busy,
    closest: (selector) => {
      if (selector === 'main,[role="main"]')
        return region === "main" ? {} : null;
      if (selector === 'nav,[role="navigation"]')
        return region === "navigation" ? {} : null;
      if (selector === '[aria-hidden="true"]') return hidden ? {} : null;
      return skeleton || busy ? {} : null;
    },
  });
  const markers = [
      marker(true, false, "main"),
      marker(false, true, "main"),
      marker(true, false, "navigation"),
      marker(true, false, "main", true),
      marker(true, false, "main", false, true),
    ],
    pulseOnly = marker(false, false, "main"),
    doc = {
      documentElement: {
        clientWidth: 1425,
        scrollWidth: 1425,
        clientHeight: 1000,
        scrollHeight: 16000,
        classList: { contains: () => false },
      },
      images: [],
      querySelectorAll: (selector) =>
        selector === '[aria-busy="true"],[data-slot="skeleton"]'
          ? markers
          : selector === ".animate-pulse"
            ? [markers[0], markers[2], pulseOnly]
            : [marker(false, false, "main")],
    },
    prefix = "capture.dom = await page.evaluate(",
    functionStart = snapshotStart + prefix.length,
    functionEnd = captureSource.indexOf("\n        });", functionStart),
    fn = captureSource.slice(functionStart, functionEnd + "\n        }".length),
    snapshot = JSON.parse(
      JSON.stringify(
        vm.runInNewContext(
          "(" + fn + ")()",
          {
            document: doc,
            getComputedStyle: () => ({ visibility: "visible" }),
            matchMedia: () => ({ matches: false }),
          },
          { timeout: 1000 },
        ),
      ),
    );
  pass(() => assert.equal(snapshot.loadingIndicators, 4));
  pass(() =>
    assert.deepEqual(snapshot.loadingMarkerCounts, {
      skeletons: 3,
      ariaBusy: 1,
      main: 3,
      navigation: 1,
      outsideMain: 1,
      ariaHidden: 1,
      pulseOnly: 1,
    }),
  );
  pass(() =>
    assert.equal(snapshot.samplePhase, "resting-after-keyboard-before-png"),
  );
  return checks;
}
