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
