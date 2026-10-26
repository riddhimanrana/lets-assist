#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "Production HTTPS request configuration is invalid." >&2
  exit 1
}

[[ $# -gt 0 ]] || fail
export VERCEL_CURL_REQUEST_PATH="$1"
shift
origin=""
bypass="${VERCEL_AUTOMATION_BYPASS_SECRET:-}"
connect_timeout=10
max_time=30
native=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployment=*)
      [[ -z "$origin" ]] || fail
      origin="${1#--deployment=}"
      ;;
    --protection-bypass=*)
      supplied="${1#--protection-bypass=}"
      [[ -z "$bypass" || "$bypass" == "$supplied" ]] || fail
      bypass="$supplied"
      ;;
    --yes) ;;
    --) [[ "$native" == false ]] || fail; native=true ;;
    --connect-timeout|--max-time)
      [[ "$native" == true && $# -ge 2 ]] || fail
      option="$1"
      shift
      [[ "$1" =~ ^[1-9][0-9]*$ ]] || fail
      if [[ "$option" == --connect-timeout ]]; then connect_timeout="$1"; else max_time="$1"; fi
      ;;
    *) fail ;;
  esac
  shift
done
export VERCEL_CURL_ORIGIN="$origin"
export VERCEL_CURL_BYPASS="$bypass"
export VERCEL_CURL_CONNECT_TIMEOUT="$connect_timeout"
export VERCEL_CURL_MAX_TIME="$max_time"

exec node --input-type=module - <<'JS'
import https from "node:https";

const fail = () => {
  console.error("Production HTTPS request failed. Response contents were suppressed.");
  process.exitCode = 1;
};
try {
  const env = process.env;
  const origin = new URL(env.VERCEL_CURL_ORIGIN);
  const path = env.VERCEL_CURL_REQUEST_PATH;
  const bypass = env.VERCEL_CURL_BYPASS;
  const connect = Number(env.VERCEL_CURL_CONNECT_TIMEOUT);
  const maximum = Number(env.VERCEL_CURL_MAX_TIME);
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.port || origin.pathname !== "/" || origin.search || origin.hash ||
    !/^[a-z0-9-]+\.vercel\.app$/u.test(origin.hostname) ||
    !path?.startsWith("/") || path.startsWith("//") || /[\\\s#\u0000-\u001f\u007f]/u.test(path) ||
    !bypass || bypass.length > 8192 || /[^\x21-\x7e]/u.test(bypass) ||
    !Number.isSafeInteger(connect) || connect < 1 || connect > 30 ||
    !Number.isSafeInteger(maximum) || maximum < connect || maximum > 120
  ) throw new Error("Invalid request");
  const target = new URL(path, origin);
  if (target.origin !== origin.origin) throw new Error("Invalid path");

  await new Promise((resolve, reject) => {
    let finished = false;
    let connectionTimer;
    let totalTimer;
    const finish = (error, body) => {
      if (finished) return;
      finished = true;
      clearTimeout(connectionTimer);
      clearTimeout(totalTimer);
      if (error) reject(new Error("Transport failed"));
      else { process.stdout.write(body); resolve(); }
    };
    const request = https.request(target, {
      method: "GET",
      agent: false,
      headers: {
        "Cache-Control": "no-cache",
        "x-vercel-protection-bypass": bypass,
      },
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        request.destroy();
        finish(new Error("HTTP request failed"));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          request.destroy();
          finish(new Error("Response too large"));
        } else chunks.push(chunk);
      });
      response.on("end", () => finish(null, Buffer.concat(chunks)));
      response.on("error", () => finish(new Error("Response failed")));
      response.on("aborted", () => finish(new Error("Response aborted")));
    });
    request.on("socket", socket => {
      socket.once("secureConnect", () => clearTimeout(connectionTimer));
    });
    request.on("error", () => finish(new Error("Request failed")));
    connectionTimer = setTimeout(() => {
      request.destroy();
      finish(new Error("Connection timed out"));
    }, connect * 1000);
    totalTimer = setTimeout(() => {
      request.destroy();
      finish(new Error("Request timed out"));
    }, maximum * 1000);
    request.end();
  });
} catch {
  fail();
}
JS
