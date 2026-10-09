import { describe, expect, test } from "bun:test";

import {
  DEFINITION_REQUIRES_SIGNING_FORM_MESSAGE,
  ESIGNATURE_DISABLED_MESSAGE,
  UNSUPPORTED_SIGNATURE_TYPE_MESSAGE,
  waiverSignatureTypeError,
} from "./signature-type-policy";

const check = (
  signatureType: unknown,
  hasDefinition: boolean,
  disableEsignature: boolean,
) =>
  waiverSignatureTypeError({ signatureType, hasDefinition, disableEsignature });

describe("waiverSignatureTypeError", () => {
  test("a project with no definition accepts every known type", () => {
    for (const type of ["draw", "typed", "upload", "multi-signer"]) {
      expect(check(type, false, false)).toBeNull();
    }
  });

  test("a project with a definition refuses the single-value types", () => {
    expect(check("draw", true, false)).toBe(
      DEFINITION_REQUIRES_SIGNING_FORM_MESSAGE,
    );
    expect(check("typed", true, false)).toBe(
      DEFINITION_REQUIRES_SIGNING_FORM_MESSAGE,
    );
    expect(check("multi-signer", true, false)).toBeNull();
    expect(check("upload", true, false)).toBeNull();
  });

  test("a project with e-signatures disabled accepts only an upload", () => {
    for (const hasDefinition of [true, false]) {
      for (const type of ["draw", "typed", "multi-signer"]) {
        expect(check(type, hasDefinition, true)).toBe(
          ESIGNATURE_DISABLED_MESSAGE,
        );
      }
      expect(check("upload", hasDefinition, true)).toBeNull();
    }
  });

  test("anything that is not a known type is refused", () => {
    for (const type of ["stamp", "", null, undefined, 3, { toString: null }]) {
      expect(check(type, false, false)).toBe(
        UNSUPPORTED_SIGNATURE_TYPE_MESSAGE,
      );
    }
  });
});
