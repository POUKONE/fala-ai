#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://jobtracker-ai-neural.ibrahimapoukone.chatgpt.site}"
REQUESTS="${REQUESTS:-500}"
CONCURRENCY="${CONCURRENCY:-25}"

echo "Fala AI load smoke: ${REQUESTS} GET requests, concurrency ${CONCURRENCY}"
seq 1 "$REQUESTS" | xargs -P"$CONCURRENCY" -I{} curl --max-time 15 -sS -o /dev/null -w '%{http_code} %{time_total}\n' "$BASE_URL/" \
  | awk '{count++; codes[$1]++; total+=$2; if($2>max)max=$2; if(min==0||$2<min)min=$2} END {printf "responses=%d avg=%.3fs min=%.3fs max=%.3fs ", count, total/count, min, max; for(code in codes) printf "status_%s=%d ", code, codes[code]; print ""}'
