import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import deepmerge from "deepmerge";

// GHSA-gcqx-w48m-w2h4: deepmerge 4.3.1 writes `destination[key]` on a fresh
// `{}`, so a `__proto__` data key replaces the returned object's prototype.
// These tests load deepmerge the way each installed consumer resolves it.
const root = join(import.meta.dir, "../..");
const installed = join(root, "node_modules/deepmerge");
const vendor = join(root, "vendor/deepmerge-compat");
const consumers = ["shadcn", "@shadcn/registry", "html-to-text"] as const;
// Merge results are JSON-like bags; assertions on them take `unknown`.
interface Bag {
  [key: string | symbol]: Bag;
}
interface Merge {
  (x: object, y: object, options?: deepmerge.Options): Bag;
  all(objects: object[], options?: deepmerge.Options): Bag;
}
const loose = deepmerge as unknown as Merge;
const fromConsumer = (name: string) =>
  createRequire(join(root, "node_modules", name, "consumer.js"));
const merges = consumers.map(
  (name) => [name, fromConsumer(name)("deepmerge") as Merge] as const,
);
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const payload = '{"__proto__":{"isAdmin":true}}';
const poisoned = (value: unknown) => {
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect((value as { isAdmin?: unknown }).isAdmin).toBeUndefined();
  expect(Object.hasOwn(value as object, "__proto__")).toBe(false);
};

describe("installed deepmerge identity", () => {
  test("every consumer resolves the one vendored, patched module", () => {
    const entry = realpathSync(join(installed, "index.cjs"));
    for (const name of consumers)
      expect(realpathSync(fromConsumer(name).resolve("deepmerge"))).toBe(entry);
    for (const [, merge] of merges) expect(merge).toBe(deepmerge);
    const files = readdirSync(vendor).sort();
    expect(readdirSync(installed).sort()).toEqual(files);
    for (const file of files)
      expect(sha256(join(installed, file))).toBe(sha256(join(vendor, file)));
  });

  test("the vendored source is upstream 4.3.1 plus only the two key guards", () => {
    const manifest = JSON.parse(
      readFileSync(join(vendor, "package.json"), "utf8"),
    );
    expect(manifest.upstream).toEqual({
      name: "deepmerge",
      version: "4.3.1",
      integrity:
        "sha512-3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A==",
      file: "dist/cjs.js",
      sha256:
        "2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d",
    });
    const source = readFileSync(join(vendor, "index.cjs"), "utf8");
    const guard =
      "\t\t\tif (propertyIsForbidden(key)) {\n\t\t\t\treturn\n\t\t\t}\n";
    const helper =
      "// Repair for GHSA-gcqx-w48m-w2h4. `__proto__` is the only key whose\n" +
      "// assignment to the plain `{}` destination calls a setter instead of\n" +
      "// creating a data property, so it is refused by name in both loops.\n" +
      "function propertyIsForbidden(key) {\n\treturn key === '__proto__'\n}\n\n";
    expect(source.split(guard)).toHaveLength(2);
    expect(source.split(helper)).toHaveLength(2);
    const original = source
      .replace(helper, "")
      .replace(guard, "")
      .replace(
        "if (propertyIsForbidden(key) || propertyIsUnsafe(target, key)) {",
        "if (propertyIsUnsafe(target, key)) {",
      );
    expect(createHash("sha256").update(original).digest("hex")).toBe(
      manifest.upstream.sha256,
    );
    // The only local line in the declarations is the lint directive.
    const [directive, ...declarations] = readFileSync(
      join(vendor, "index.d.ts"),
      "utf8",
    ).split("\n");
    expect(directive).toStartWith(
      "/* eslint-disable @typescript-eslint/no-explicit-any -- upstream",
    );
    expect(
      createHash("sha256").update(declarations.join("\n")).digest("hex"),
    ).toBe("146ba4b99c5feb82663e17a671bf9f53bb39c704cd76345d6c5a801c26372f44");
    expect(sha256(join(vendor, "license.txt"))).toBe(
      "6cfc4687cb2f2d86f4a77e6b526290d3878e5e512f3fec2f4cb36a9cb36f798b",
    );
  });

  test("CommonJS, ESM default and all keep the upstream surface", async () => {
    const esm = await import("deepmerge");
    expect(esm.default).toBe(deepmerge);
    expect(typeof deepmerge).toBe("function");
    expect(typeof deepmerge.all).toBe("function");
    expect(() => deepmerge.all({} as never)).toThrow(
      "first argument should be an array",
    );
  });
});

for (const [name, merge] of merges) {
  describe(`prototype poisoning through ${name}`, () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();

    test("a null-prototype target", () => {
      const target = Object.assign(Object.create(null), { debug: false });
      const merged = merge(target, JSON.parse(payload));
      poisoned(merged);
      expect<unknown>(merged.debug).toBe(false);
    });

    test("a null, undefined or primitive placeholder", () => {
      for (const placeholder of [null, undefined, 80, "text", true]) {
        const merged = merge(
          { session: placeholder },
          JSON.parse(`{"session":${payload}}`),
        );
        poisoned(merged.session);
      }
    });

    test("a target with its own __proto__ key", () => {
      const merged = merge(
        JSON.parse('{"__proto__":{"isAdmin":true},"debug":false}'),
        { verbose: true },
      );
      poisoned(merged);
      expect<unknown>(merged).toEqual({ debug: false, verbose: true });
    });

    test("a nested placeholder", () => {
      poisoned(
        merge({ a: { b: null } }, JSON.parse(`{"a":{"b":${payload}}}`)).a.b,
      );
    });

    test("merge.all", () => {
      poisoned(
        merge.all([{ session: null }, JSON.parse(`{"session":${payload}}`)])
          .session,
      );
    });

    test("clone false and customMerge", () => {
      poisoned(
        merge(Object.create(null), JSON.parse(payload), { clone: false }),
      );
      poisoned(
        merge(Object.create(null), JSON.parse(payload), {
          customMerge: () => undefined,
        }),
      );
    });

    test("a custom arrayMerge callback", () => {
      // The upstream readme's combineMerge example.
      const combine = (
        target: unknown[],
        source: unknown[],
        options?: deepmerge.ArrayMergeOptions,
      ) => {
        const destination = target.slice();
        source.forEach((item, index) => {
          if (typeof destination[index] === "undefined")
            destination[index] = options!.cloneUnlessOtherwiseSpecified(
              item as object,
              options as deepmerge.Options,
            );
          else if (options!.isMergeableObject(item as object))
            destination[index] = merge(
              target[index] as object,
              item as object,
              options as deepmerge.Options,
            );
          else if (!target.includes(item)) destination.push(item);
        });
        return destination;
      };
      poisoned(
        merge({ list: [null] }, JSON.parse(`{"list":[${payload}]}`), {
          arrayMerge: combine,
        }).list[0],
      );
    });

    test("default array cloning (already safe upstream)", () => {
      poisoned(
        merge({ list: [] }, JSON.parse(`{"list":[${payload}]}`)).list[0],
      );
    });

    test("Object.prototype is never changed", () => {
      expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
        before,
      );
      expect(({} as { isAdmin?: unknown }).isAdmin).toBeUndefined();
    });
  });
}

describe("legitimate deepmerge behavior is unchanged", () => {
  test("an ordinary target already ignored __proto__ and still does", () => {
    poisoned(loose({}, JSON.parse(payload)));
  });

  test("objects, arrays, cloning, symbols and special values", () => {
    const visible = Symbol("visible");
    const hidden = Symbol("hidden");
    const source: Record<PropertyKey, unknown> = { [visible]: 1 };
    Object.defineProperty(source, hidden, { value: 2, enumerable: false });
    const merged = loose(source, { [visible]: 3 });
    expect<unknown>(merged[visible]).toBe(3);
    expect(Object.getOwnPropertySymbols(merged)).toEqual([visible]);

    const nested = { deep: { kept: 1 } };
    const copy = loose({}, nested);
    expect<unknown>(copy).toEqual(nested);
    expect<unknown>(copy.deep).not.toBe(nested.deep);
    expect<unknown>(loose({}, nested, { clone: false }).deep).toBe(nested.deep);

    expect<unknown>(loose({ list: [1, { a: 1 }] }, { list: [2] })).toEqual({
      list: [1, { a: 1 }, 2],
    });
    expect<unknown>(
      loose({ list: [1] }, { list: [2] }, { arrayMerge: (_t, s) => s }),
    ).toEqual({ list: [2] });

    const date = new Date(0);
    const pattern = /x/u;
    const element = { $$typeof: Symbol.for("react.element"), props: {} };
    const special = loose(
      { date: {}, pattern: {}, element: {} },
      {
        date,
        pattern,
        element,
      },
    );
    expect<unknown>(special.date).toBe(date);
    expect<unknown>(special.pattern).toBe(pattern);
    expect<unknown>(special.element).toBe(element);
  });

  test("customMerge, isMergeableObject and all", () => {
    const merged = loose(
      { name: { first: "A" }, keep: { a: 1 } },
      { name: { first: "B" }, keep: { b: 2 } },
      {
        customMerge: (key) =>
          key === "name" ? (_x: unknown, y: unknown) => y : undefined,
      },
    );
    expect<unknown>(merged).toEqual({
      name: { first: "B" },
      keep: { a: 1, b: 2 },
    });
    const shallow = loose(
      { box: { a: 1 } },
      { box: { b: 2 } },
      { isMergeableObject: (value) => Array.isArray(value) },
    );
    expect<unknown>(shallow).toEqual({ box: { b: 2 } });
    expect<unknown>(loose.all([{ a: 1 }, { b: 2 }, { a: 3 }])).toEqual({
      a: 3,
      b: 2,
    });
  });

  test("constructor and prototype keys keep their upstream handling", () => {
    // Plain targets already skip inherited names; null-prototype targets
    // keep them as ordinary data.
    expect<unknown>(
      loose({}, JSON.parse('{"constructor":1}')).constructor,
    ).toBe(Object);
    const open = loose(
      Object.create(null),
      JSON.parse('{"constructor":1,"prototype":2}'),
    );
    expect<unknown>(open).toEqual({ constructor: 1, prototype: 2 });
    expect(Object.getPrototypeOf(open)).toBe(Object.prototype);
  });
});

describe("html-to-text with the installed deepmerge", () => {
  const html = '<p>Visible <span class="note">note text</span></p>';
  test("legitimate selector, array and duplicate merges", async () => {
    const { convert } = await import(
      join(root, "node_modules/html-to-text/lib/html-to-text.mjs")
    );
    expect(
      convert('<h1>Title</h1><a href="https://example.test/x">link</a>', {
        wordwrap: false,
        selectors: [
          { selector: "h1", options: { uppercase: false } },
          { selector: "a", options: { ignoreHref: true } },
        ],
      }),
    ).toBe("Title\n\nlink");
    expect(
      convert(html, {
        wordwrap: false,
        selectors: [{ selector: "span.note", format: "skip" }],
      }),
    ).toBe("Visible");
  });

  test("untrusted options cannot hide text through an inherited format", async () => {
    const { convert } = await import(
      join(root, "node_modules/html-to-text/lib/html-to-text.mjs")
    );
    const untrusted = JSON.parse(
      '{"wordwrap":false,"selectors":[{"selector":"span.note","__proto__":{"format":"skip"}},{"selector":"span.note"}]}',
    );
    // Unpatched, the merged selector inherits `format: "skip"` and the note
    // silently disappears. Repaired, it has no format and html-to-text refuses.
    expect(() => convert(html, untrusted)).toThrow(
      "Following selectors have no specified format: `span.note`",
    );
  });
});
