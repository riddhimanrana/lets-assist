import type { GlobOptions } from "tinyglobby";

type Options = GlobOptions & { unique?: boolean };

declare function fastGlob(
  patterns: string | string[],
  options?: Options,
): Promise<string[]>;

declare namespace fastGlob {
  const glob: typeof fastGlob;
  function globSync(patterns: string | string[], options?: Options): string[];
  const sync: typeof globSync;
}

export = fastGlob;
