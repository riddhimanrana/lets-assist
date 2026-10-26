import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ReleaseCheckError } from "./app-release-checks.mjs";
import {
  applicationRequestWriteFlagSql,
  settlePreexistingRequestTransactionsSql,
} from "./request-write-fence.mjs";
import {
  productionTransportConfig,
  prepareLinkedBootstrapConnection,
  executeLinkedBootstrapQuery,
} from "./linked-bootstrap-transport.mjs";

export async function setApplicationWriteBlock(mode, env, dependencies = {}) {
  if (!["enable", "disable", "barrier"].includes(mode))
    throw new ReleaseCheckError("Invalid Production write-block mode.");
  const config = productionTransportConfig(env);
  const connection = await prepareLinkedBootstrapConnection(
    config,
    dependencies.fetcher,
  );
  const sql =
    mode === "barrier"
      ? settlePreexistingRequestTransactionsSql
      : applicationRequestWriteFlagSql(mode === "enable");
  return executeLinkedBootstrapQuery(
    connection,
    sql,
    config.databasePassword,
    dependencies.execute,
    { timeout: 45_000 },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw new ReleaseCheckError("One fixed write-block mode is required.");
    await setApplicationWriteBlock(process.argv[2], process.env);
  } catch (error) {
    console.error(
      error instanceof ReleaseCheckError
        ? error.message
        : "Production write-block transport failed. Raw output was suppressed.",
    );
    process.exitCode = 1;
  }
}
