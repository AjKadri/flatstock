#!/usr/bin/env bash
# One-command fork test for the low-balance guard.
#   bash web/relayer/run-fork-test.sh
# Starts a local anvil fork of Robinhood Chain, runs the fork test, then stops anvil.
# Read-only against the real chain: balances are changed only inside the local fork.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
FORK_URL="${RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
PORT="${ANVIL_PORT:-8545}"
command -v anvil >/dev/null || { echo "anvil not found: install Foundry first" >&2; exit 1; }

anvil --fork-url "$FORK_URL" --port "$PORT" --chain-id 4663 --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT

for i in $(seq 1 60); do
  if curl -s -m 2 -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q result; then
    break
  fi
  sleep 1
  if [ "$i" = 60 ]; then echo "anvil did not start" >&2; exit 1; fi
done

FORK_RPC_URL="http://127.0.0.1:$PORT" node --test --test-concurrency=1 relayer/sponsorship-guard.fork.test.ts relayer/buy-round.fork.test.ts relayer/price-guard.fork.test.ts relayer/close-round.fork.test.ts
