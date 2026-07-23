#!/usr/bin/env bash
# Launcher for the news-crawler app.
#   1. Stops anything already listening on PORT (default 31313).
#   2. Starts the UI/factory server on that same port.
#
# Usage:  ./launch.sh            # port 31313
#         PORT=8080 ./launch.sh  # override
set -euo pipefail

PORT="${PORT:-31313}"
cd "$(dirname "$0")"

echo "[launch] freeing port ${PORT}..."
# Find every PID listening on PORT and kill it (Windows/Git-Bash: use netstat).
PIDS="$(netstat -ano 2>/dev/null | grep -E ":${PORT}[[:space:]]" | grep -i LISTENING | awk '{print $NF}' | sort -u || true)"
if [ -n "${PIDS}" ]; then
  for pid in ${PIDS}; do
    echo "[launch]   killing PID ${pid}"
    taskkill //PID "${pid}" //F >/dev/null 2>&1 || kill -9 "${pid}" >/dev/null 2>&1 || true
  done
  sleep 1
else
  echo "[launch]   nothing was listening on ${PORT}"
fi

echo "[launch] starting server on port ${PORT}..."
export PORT
# Force IPv4-first DNS. The Supabase direct host resolves to an IPv6-only
# address that this network can't route (ENETUNREACH), while its IPv4 path
# works. Without this, pg intermittently picks IPv6 and reports the DB as
# "unavailable". See also NODE_OPTIONS below for child processes.
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"
exec node --dns-result-order=ipv4first src/server.js
