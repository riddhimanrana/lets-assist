import { describe, expect, test } from "bun:test";

import {
  COMMITTED_PRODUCTION_SUPABASE_REF,
  REQUIRED_PRODUCTION_CONFIRMATION,
  assertProductionSchemaDeploymentAuthorization,
} from "./verify-production-schema-deployment.mjs";

const authorizedEnvironment = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  PRODUCTION_DEPLOY_CONFIRMATION: REQUIRED_PRODUCTION_CONFIRMATION,
  SUPABASE_PROJECT_ID: COMMITTED_PRODUCTION_SUPABASE_REF,
  LINKED_SUPABASE_PROJECT_REF: COMMITTED_PRODUCTION_SUPABASE_REF,
};

describe("production schema deployment authorization", () => {
  test("accepts only a manually confirmed main deployment to the committed ref", () => {
    expect(() =>
      assertProductionSchemaDeploymentAuthorization(authorizedEnvironment),
    ).not.toThrow();
  });

  test("rejects push-triggered deployment", () => {
    expect(() =>
      assertProductionSchemaDeploymentAuthorization({
        ...authorizedEnvironment,
        GITHUB_EVENT_NAME: "push",
      }),
    ).toThrow("requires workflow_dispatch");
  });

  test("rejects dispatches from any branch other than main", () => {
    expect(() =>
      assertProductionSchemaDeploymentAuthorization({
        ...authorizedEnvironment,
        GITHUB_REF: "refs/heads/development",
      }),
    ).toThrow("requires refs/heads/main");
  });

  test("rejects an inexact confirmation or configured project ref", () => {
    expect(() =>
      assertProductionSchemaDeploymentAuthorization({
        ...authorizedEnvironment,
        PRODUCTION_DEPLOY_CONFIRMATION: "deploy-production",
      }),
    ).toThrow("requires the exact confirmation");

    expect(() =>
      assertProductionSchemaDeploymentAuthorization({
        ...authorizedEnvironment,
        SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst",
      }),
    ).toThrow("does not match the committed ref");
  });

  test("rejects a different project after Supabase link", () => {
    expect(() =>
      assertProductionSchemaDeploymentAuthorization({
        ...authorizedEnvironment,
        LINKED_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      }),
    ).toThrow("Linked Supabase project ref does not match");
  });
});
