import assert from "node:assert/strict";
import test from "node:test";

import {
  isCsfConnectOnboardingContext,
  shouldShowOnboardingModal,
} from "./onboarding-visibility";

const csfContext = {
  pathname: "/organization/dvhs/plugins/dvhs-csf/connect/abc123",
  connectedParam: "1",
  signupFlow: "csf_connect",
};

test("CSF connect onboarding context requires flow, route, and signal", () => {
  assert.equal(isCsfConnectOnboardingContext(csfContext), true);
  assert.equal(
    isCsfConnectOnboardingContext({
      ...csfContext,
      pathname: "/organization/dvhs/plugins/dvhs-csf/connect",
    }),
    true,
  );

  assert.equal(
    isCsfConnectOnboardingContext({ ...csfContext, signupFlow: undefined }),
    false,
  );
  assert.equal(
    isCsfConnectOnboardingContext({ ...csfContext, signupFlow: "other" }),
    false,
  );
  assert.equal(
    isCsfConnectOnboardingContext({ ...csfContext, connectedParam: null }),
    false,
  );
  assert.equal(
    isCsfConnectOnboardingContext({ ...csfContext, connectedParam: "0" }),
    false,
  );
  assert.equal(
    isCsfConnectOnboardingContext({ ...csfContext, pathname: "/home" }),
    false,
  );
  assert.equal(
    isCsfConnectOnboardingContext({ ...csfContext, pathname: null }),
    false,
  );
});

test("modal predicate matches historical /home behavior without CSF context", () => {
  const base = {
    onboardingCompleted: false,
    suppressOnboardingModal: false,
    suppressOnboardingAfterReturn: false,
    isHomeRoute: true,
    isCsfConnectContext: false,
  };

  assert.equal(shouldShowOnboardingModal(base), true);
  assert.equal(
    shouldShowOnboardingModal({ ...base, onboardingCompleted: true }),
    false,
  );
  assert.equal(
    shouldShowOnboardingModal({ ...base, suppressOnboardingModal: true }),
    false,
  );
  assert.equal(
    shouldShowOnboardingModal({ ...base, suppressOnboardingAfterReturn: true }),
    false,
  );
  assert.equal(
    shouldShowOnboardingModal({ ...base, isHomeRoute: false }),
    false,
  );
});

test("modal predicate also fires on the connect route in CSF context", () => {
  const base = {
    onboardingCompleted: false,
    suppressOnboardingModal: false,
    suppressOnboardingAfterReturn: false,
    isHomeRoute: false,
    isCsfConnectContext: true,
  };

  assert.equal(shouldShowOnboardingModal(base), true);
  assert.equal(
    shouldShowOnboardingModal({ ...base, onboardingCompleted: true }),
    false,
  );
  assert.equal(
    shouldShowOnboardingModal({ ...base, suppressOnboardingAfterReturn: true }),
    false,
  );
});

test("waiting on staff settles the CSF step too, so account setup still finishes", () => {
  // Most students now wait: a class code no longer creates a record. Gating
  // on connection alone would leave a brand new account without a username.
  const waiting = { ...csfContext, connectedParam: null, reviewParam: "1" };
  assert.equal(isCsfConnectOnboardingContext(waiting), true);
  assert.equal(
    shouldShowOnboardingModal({
      onboardingCompleted: false,
      suppressOnboardingModal: false,
      suppressOnboardingAfterReturn: false,
      isHomeRoute: false,
      isCsfConnectContext: isCsfConnectOnboardingContext(waiting),
    }),
    true,
  );

  // Mid-claim, before either signal, the modal still must not interrupt.
  assert.equal(
    isCsfConnectOnboardingContext({
      ...csfContext,
      connectedParam: null,
      reviewParam: null,
    }),
    false,
  );
  assert.equal(
    isCsfConnectOnboardingContext({
      ...csfContext,
      connectedParam: null,
      reviewParam: "0",
    }),
    false,
  );
  // The signal is only trusted on the CSF connect route.
  assert.equal(
    isCsfConnectOnboardingContext({
      ...csfContext,
      connectedParam: null,
      reviewParam: "1",
      pathname: "/home",
    }),
    false,
  );
});
