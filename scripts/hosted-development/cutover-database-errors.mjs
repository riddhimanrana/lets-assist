/** Return only fixed labels; provider text never becomes diagnostic output. */
export function databaseFailureCategory(error) {
  const stderr =
    typeof error?.stderr === "string"
      ? error.stderr
      : Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString("utf8")
        : "";
  const categories = [
    [/Network is unreachable|No route to host/iu, "network unreachable"],
    [
      /could not translate host name|Name or service not known|Temporary failure in name resolution/iu,
      "name resolution",
    ],
    [/connection.*timed out|timeout expired/iu, "connection timeout"],
    [/Connection refused/iu, "connection refused"],
    [
      /password authentication failed|SASL authentication failed|Tenant or user not found/iu,
      "authentication",
    ],
    [
      /SSL error|certificate verify failed|server does not support SSL/iu,
      "TLS connection",
    ],
    [/permission denied|must be owner of/iu, "SQL permission"],
    [/cannot execute.*read-only transaction/iu, "read-only rejection"],
    [/canceling statement due to statement timeout/iu, "query timeout"],
  ];
  for (const [pattern, category] of categories)
    if (pattern.test(stderr)) return category;
  if (error?.code === "ETIMEDOUT") return "client timeout";
  if (["ENOENT", "EACCES"].includes(error?.code))
    return "database client execution";
  return undefined;
}
