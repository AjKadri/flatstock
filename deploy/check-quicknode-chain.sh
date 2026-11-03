#!/usr/bin/env bash
set -euo pipefail

env_file="${FLATSTOCK_ENV_FILE:-/etc/flatstock/flatstock.env}"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

if [[ ! -r "$env_file" ]] || ! source "$env_file" 2>/dev/null || [[ -z "${QUICKNODE_RPC_URL:-}" ]]; then
  printf 'http_status=not_run\nchain_id=unavailable\n'
  exit 1
fi

payload='{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
http_status=000
if status="$(curl --silent --output "$response_file" --write-out '%{http_code}' \
  --header 'content-type: application/json' \
  --data "$payload" \
  "$QUICKNODE_RPC_URL" 2>/dev/null)"; then
  http_status="${status:-000}"
fi

chain_id="$(node --input-type=module -e '
  import fs from "node:fs";
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(typeof payload.result === "string" ? payload.result : "unavailable");
  } catch {
    process.stdout.write("unavailable");
  }
' < "$response_file" 2>/dev/null || true)"

printf 'http_status=%s\nchain_id=%s\n' "$http_status" "${chain_id:-unavailable}"
