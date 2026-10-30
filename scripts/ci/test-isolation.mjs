// Which test files must run in their own Bun process.
//
// `mock.module` replaces a module for the whole process. `installMinimalDom()`
// (tests/support/minimal-dom.ts) puts `window`, `document` and DOM classes on
// `globalThis`, and those lifecycle tests also swap globals such as timers.
// Either would leak into unrelated files sharing a process.

const mockModulePattern = /\bmock\s*\.\s*module\s*\(/u;
// A call, not the declaration, an import, or a mention in a comment or string.
const minimalDomInstallPattern =
  /^(?!\s*(?:\/\/|\*|\/\*))[^\n'"`]*(?<!function\s+)\binstallMinimalDom\s*\(/mu;

/** @param {string} source */
export function needsIsolatedProcess(source) {
  return (
    mockModulePattern.test(source) || minimalDomInstallPattern.test(source)
  );
}
