#!/bin/sh
# Local test database helpers.  Usage:  tests/db.sh unit   (SQL test suite)
#                                       tests/db.sh fresh  (schema + seed into "allure" for browser tests)
# Needs PostgreSQL 14+ installed (Homebrew). Data lives in $WORK (default: ./.tmp/testdb).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/.tmp/testdb}"
PORT="${PGPORT_TEST:-54329}"
Q() { psql -h 127.0.0.1 -p "$PORT" -U postgres "$@"; }
mkdir -p "$WORK"
if [ ! -d "$WORK/data" ]; then initdb -D "$WORK/data" -U postgres --auth=trust >/dev/null; fi
if ! pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  pg_ctl -D "$WORK/data" -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l "$WORK/log.txt" start >/dev/null; sleep 2
fi
sed 's/^create extension if not exists pg_net;/-- (pg_net stubbed locally)/' "$ROOT/supabase/schema.sql" > "$WORK/schema_local.sql"
load() {  # $1 = database
  Q -q -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null 2>&1
  Q -d "$1" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/stubs.sql" >/dev/null 2>&1
  Q -d "$1" -v ON_ERROR_STOP=1 -q -f "$WORK/schema_local.sql" 2>&1 | grep -v NOTICE || true
  Q -d "$1" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql" 2>&1 | grep -v NOTICE || true
}
case "$1" in
  unit)  load allure_unit
         Q -d allure_unit -t -f "$ROOT/tests/test.sql" 2>&1 | grep -v '^ *$' | grep -v 'NOTICE:  ok' | sed 's/^psql:[^:]*:[0-9]*: //' ;;
  fresh) load allure; echo fresh-db-ready ;;
  stop)  pg_ctl -D "$WORK/data" stop -m fast >/dev/null && echo stopped ;;
  *) echo "usage: tests/db.sh unit|fresh|stop"; exit 1 ;;
esac
