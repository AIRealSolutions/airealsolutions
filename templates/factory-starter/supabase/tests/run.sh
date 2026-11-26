#!/usr/bin/env bash
# Run the RLS tests.
#   DATABASE_URL=postgres://... npm run test:rls   -> against that database (a Supabase branch: migration must already be applied)
#   npm run test:rls                                -> spins up a throwaway local Postgres, applies stub auth + migrations
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -n "${DATABASE_URL:-}" ]]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -o /dev/null -f supabase/tests/rls.sql
  exit 0
fi

BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[[ -x "$BIN/initdb" ]] || BIN="$(dirname "$(command -v initdb || echo /nonexistent/initdb)")"
[[ -x "$BIN/initdb" ]] || { echo "Postgres server binaries not found; set DATABASE_URL instead." >&2; exit 1; }

DIR="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then chown -R postgres "$DIR"; RUN_AS=(runuser -u postgres --); fi
cleanup() { "${RUN_AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null

URL="postgresql://postgres@/postgres?host=$DIR&port=$PORT"
PGOPTIONS="-c client_min_messages=warning" psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/stub-auth.sql
for f in supabase/migrations/*.sql; do PGOPTIONS="-c client_min_messages=warning" psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$URL" -v ON_ERROR_STOP=1 -q -o /dev/null -f supabase/tests/rls.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: //'
