import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

import { isSecureCheckBlockingSubmit } from "../../lib/auth/secure-check";

const source = ts.createSourceFile(
  "LoginClient.tsx",
  readFileSync(new URL("./LoginClient.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let submitSource = "";
function findSubmit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "onSubmit") {
    submitSource = node.getText(source);
  }
  ts.forEachChild(node, findSubmit);
}
findSubmit(source);
if (!submitSource) throw new Error("Login submit handler was not found.");

// Exercise the component's handler without mounting a real CAPTCHA or signing in.
const submitCode = ts.transpileModule(submitSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(phase: string, token?: string) {
  const signIn = mock(async () => ({
    data: null,
    error: { message: "Invalid login credentials" },
  }));
  const createClient = mock(() => ({ auth: { signInWithPassword: signIn } }));
  const loading = mock(() => {});
  const toastError = mock(() => {});
  const dependencies = {
    turnstileRef: {
      current: { getResponse: () => token, reset: mock(() => {}) },
    },
    secureCheck: { phase },
    isSecureCheckBlockingSubmit,
    toast: { error: toastError },
    setIsLoading: loading,
    setTurnstileVerified: mock(() => {}),
    createClient,
  };
  const submit = new Function(
    ...Object.keys(dependencies),
    `${submitCode}\nreturn onSubmit;`,
  )(...Object.values(dependencies)) as (values: {
    email: string;
    password: string;
  }) => Promise<void>;
  return { submit, signIn, createClient, loading, toastError };
}

const credentials = { email: "student@example.invalid", password: "fictional" };

describe("login challenge submission", () => {
  for (const [phase, token] of [
    ["loading", undefined],
    ["loading", "stale-token"],
    ["ready", undefined],
    ["ready", ""],
    ["ready", "   "],
    ["unavailable", "stale-token"],
  ] as const) {
    test(`does not contact Auth when ${phase} with ${JSON.stringify(token)}`, async () => {
      const run = setup(phase, token);
      await run.submit(credentials);
      expect(run.createClient).not.toHaveBeenCalled();
      expect(run.signIn).not.toHaveBeenCalled();
      expect(run.loading).not.toHaveBeenCalled();
      expect(run.toastError).toHaveBeenCalledTimes(1);
    });
  }

  test("passes the current challenge token to Auth once", async () => {
    const run = setup("ready", "current-token");
    await run.submit(credentials);
    expect(run.signIn).toHaveBeenCalledTimes(1);
    expect(run.signIn).toHaveBeenCalledWith({
      ...credentials,
      options: { captchaToken: "current-token" },
    });
  });

  test("preserves the existing local fixture bypass", async () => {
    const run = setup("ready", "turnstile-bypass");
    await run.submit(credentials);
    expect(run.signIn).toHaveBeenCalledWith({
      ...credentials,
      options: undefined,
    });
  });
});
