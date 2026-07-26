#!/usr/bin/env bash
# Overnight v2 dispersion-sensitivity sweep (SLS-93 / SLS-110).
#
# Starts the MPC Python service, waits for it to be healthy, runs the full
# PID/RL/MPC width sweep with timestamped logging, then stops the service.
# Safe to background: `nohup bash tools/eval/run-campaign-overnight.sh &`.
#
# Env overrides:
#   SEEDS=30                seeds per (controller, scenario, width) cell
#   WIDTHS=20,50,100,200,400   position-σ widths (m)
#   CONTROLLERS=pid,rl,mpc  which controllers to sweep
#
# Results  → eval/results/v2-sweep-*.json
# Live log → eval/results/campaign-<stamp>.log  (tail -f it in the morning)

set -uo pipefail
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

SEEDS="${SEEDS:-30}"
WIDTHS="${WIDTHS:-20,50,100,200,400}"
CONTROLLERS="${CONTROLLERS:-pid,rl,mpc}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="eval/results/campaign-${STAMP}.log"
mkdir -p eval/results

echo "=== v2 sweep overnight run @ ${STAMP} ===" | tee "$LOG"
echo "seeds=${SEEDS} widths=${WIDTHS} controllers=${CONTROLLERS}" | tee -a "$LOG"
echo "commit=$(git rev-parse --short HEAD)" | tee -a "$LOG"

MPC_PID=""
cleanup() {
  if [ -n "$MPC_PID" ]; then
    echo "stopping MPC service (pid $MPC_PID)" | tee -a "$LOG"
    kill "$MPC_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Start the MPC service only if MPC is in scope.
if printf '%s' "$CONTROLLERS" | grep -q mpc; then
  echo "starting MPC service…" | tee -a "$LOG"
  ( cd services/mpc && uv run uvicorn mpc.server:app --host 127.0.0.1 --port 8100 ) \
    >> "eval/results/mpc-service-${STAMP}.log" 2>&1 &
  MPC_PID=$!
  # Wait up to 60 s for health.
  ready=0
  for _ in $(seq 1 60); do
    if curl -sf http://localhost:8100/health >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" != "1" ]; then
    echo "MPC service failed to become healthy — aborting." | tee -a "$LOG"
    exit 1
  fi
  echo "MPC service healthy." | tee -a "$LOG"
fi

echo "launching sweep…" | tee -a "$LOG"
pnpm campaign:v2 --seeds "$SEEDS" --widths "$WIDTHS" --controllers "$CONTROLLERS" 2>&1 | tee -a "$LOG"
STATUS=${PIPESTATUS[0]}

echo "=== sweep finished (exit $STATUS) @ $(date +%H:%M:%S) ===" | tee -a "$LOG"
exit "$STATUS"
