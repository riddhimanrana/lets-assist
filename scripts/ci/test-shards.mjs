// Deterministic partition of a test inventory across parallel CI runners.
//
// Every runner computes the same inventory from the same checkout, sorts it by
// UTF-16 code unit (never by locale), and takes the files whose position is
// congruent to its shard index. Positions are disjoint and cover the list, so
// the shards together run every file exactly once whatever order discovery
// returned them in.

const MAXIMUM_SHARDS = 32;

export function parseShard(value) {
  const match = /^([1-9]\d{0,2})\/([1-9]\d{0,2})$/u.exec(value ?? "");
  if (!match) {
    throw new Error(
      `Invalid shard "${value ?? ""}". Use <index>/<total>, for example 1/3.`,
    );
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total > MAXIMUM_SHARDS) {
    throw new Error(
      `Invalid shard "${value}". At most ${MAXIMUM_SHARDS} shards are supported.`,
    );
  }
  if (index > total) {
    throw new Error(
      `Invalid shard "${value}". The index cannot exceed the total.`,
    );
  }
  return { index, total };
}

// The one flag both runners accept. Returns null when the flag is absent and
// throws when it is repeated or malformed, so a typo cannot silently run
// either everything or nothing.
export function shardFromArguments(args) {
  const values = args.filter((argument) => argument.startsWith("--shard"));
  if (values.length === 0) return null;
  if (values.length > 1) {
    throw new Error("Invalid shard. Pass --shard=<index>/<total> once.");
  }
  if (!values[0].startsWith("--shard=")) {
    throw new Error(
      `Invalid shard "${values[0]}". Use --shard=<index>/<total>.`,
    );
  }
  return parseShard(values[0].slice("--shard=".length));
}

export function canonicalFiles(files) {
  return [...new Set(files)].sort();
}

export function partitionFiles(files, total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > MAXIMUM_SHARDS) {
    throw new Error(`Invalid shard total: ${total}.`);
  }
  const shards = Array.from({ length: total }, () => []);
  canonicalFiles(files).forEach((file, position) => {
    shards[position % total].push(file);
  });
  return shards;
}

export function selectShard(files, shard) {
  if (shard === null) return canonicalFiles(files);
  return partitionFiles(files, shard.total)[shard.index - 1];
}
