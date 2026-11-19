#!/usr/bin/env bash
# Simulates the Safe-batch scripts against a local anvil. No public broadcast.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out/safe
anvil --port 8545 --silent >/tmp/anvil-safe.log 2>&1 &
anvil_pid=$!
trap 'kill "$anvil_pid" >/dev/null 2>&1 || true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done
sender=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
forge script script/SetupSafeBatchSim.s.sol \
  --tc SetupSafeBatchSim \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --unlocked \
  --sender "$sender"
set -a
# shellcheck disable=SC1091
source out/safe/sim.env
set +a
forge script script/SetOFTPeers.s.sol --rpc-url http://127.0.0.1:8545
forge script script/SafeSetExcluder.s.sol --rpc-url http://127.0.0.1:8545
forge script script/SafeGraduateLive.s.sol --rpc-url http://127.0.0.1:8545
python3 - << 'PY'
import json
from pathlib import Path
root = Path("out/safe")
for name, txs in (("set-peer.json", 1), ("set-excluder.json", 2), ("graduate-live.json", 3)):
    data = json.loads((root / name).read_text())
    got = data["transactions"]
    if len(got) != txs:
        raise SystemExit(f"{name} has {len(got)} transactions, want {txs}")
    if not got[0]["data"].startswith("0x"):
        raise SystemExit(f"{name} missing calldata")
print("safe batches ok")
PY
