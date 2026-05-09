import { readFile } from "node:fs/promises";
import process from "node:process";
import { importPKCS8, SignJWT } from "jose";

const DEFAULT_ENDPOINT = "https://lets-assist.com/api/security/google/cap";
const DEFAULT_EVENTS = [
  "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
  "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
  "https://schemas.openid.net/secevent/oauth/event-type/token-revoked",
  "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  "https://schemas.openid.net/secevent/risc/event-type/account-enabled",
  "https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required",
  "https://schemas.openid.net/secevent/risc/event-type/verification",
];

function parseArgs(argv) {
  const args = {
    serviceAccount: null,
    endpoint: DEFAULT_ENDPOINT,
    verifyState: `lets-assist-${Date.now()}`,
    events: DEFAULT_EVENTS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--service-account" || value === "-s") {
      args.serviceAccount = argv[++i] ?? null;
      continue;
    }

    if (value === "--endpoint" || value === "-e") {
      args.endpoint = argv[++i] ?? DEFAULT_ENDPOINT;
      continue;
    }

    if (value === "--verify-state") {
      args.verifyState = argv[++i] ?? args.verifyState;
      continue;
    }

    if (value === "--events") {
      const raw = argv[++i] ?? "";
      args.events = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }

  return args;
}

async function makeServiceAccountAccessToken(serviceAccount) {
  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);

  const scope = [
    "https://www.googleapis.com/auth/risc.configuration.readwrite",
    "https://www.googleapis.com/auth/risc.verify",
  ].join(" ");

  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", kid: serviceAccount.private_key_id, typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience(serviceAccount.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to exchange service account assertion for access token: ${response.status} ${text}`);
  }

  const tokenResponse = JSON.parse(text);
  if (!tokenResponse.access_token) {
    throw new Error("Token exchange response did not include access_token");
  }

  return tokenResponse.access_token;
}

async function postJson(url, body, authToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return { ok: response.ok, status: response.status, body: parsed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.serviceAccount) {
    console.error("Usage: bun node scripts/google-cap/register-risc.mjs --service-account <path> [--endpoint <url>] [--verify-state <text>] [--events <comma-separated-events>]");
    process.exit(1);
  }

  const raw = await readFile(args.serviceAccount, "utf8");
  const serviceAccount = JSON.parse(raw);

  if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.private_key_id) {
    throw new Error("Service account JSON is missing client_email, private_key, or private_key_id");
  }

  const authToken = await makeServiceAccountAccessToken(serviceAccount);

  const streamConfig = {
    delivery: {
      delivery_method: "https://schemas.openid.net/secevent/risc/delivery-method/push",
      url: args.endpoint,
    },
    events_requested: args.events,
  };

  console.log(`Registering RISC stream for ${args.endpoint}`);
  const updateResult = await postJson("https://risc.googleapis.com/v1beta/stream:update", streamConfig, authToken);
  console.log("stream:update status:", updateResult.status);
  console.log(JSON.stringify(updateResult.body, null, 2));

  if (!updateResult.ok) {
    process.exitCode = 1;
    return;
  }

  console.log(`\nRequesting verification token with state: ${args.verifyState}`);
  const verifyResult = await postJson(
    "https://risc.googleapis.com/v1beta/stream:verify",
    { state: args.verifyState },
    authToken,
  );
  console.log("stream:verify status:", verifyResult.status);
  console.log(JSON.stringify(verifyResult.body, null, 2));

  if (!verifyResult.ok) {
    process.exitCode = 1;
    return;
  }

  console.log("\nDone. Check the receiver logs for the verification event and the Google console for the registered stream.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});