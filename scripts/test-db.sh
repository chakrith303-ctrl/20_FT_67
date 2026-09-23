#!/usr/bin/env bash
# รันการทดสอบทั้งหมดบน PostgreSQL ชั่วคราวในเครื่อง:
#   1) migrate.js (ทดสอบตัว migrate ด้วย — รัน 2 รอบต้องไม่พัง)
#   2) ชุดทดสอบ SQL ใน db/tests
#   3) ชุดทดสอบ API ใน test/
# ต้องมี PostgreSQL 15+ (initdb, pg_ctl, psql) และรัน npm install แล้ว
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb)")}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUN=()
if [ "$(id -u)" = "0" ]; then
  chown nobody "$WORK" 2>/dev/null || chown nobody:nogroup "$WORK"
  RUN=(runuser -u nobody --)
fi

cleanup() {
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -o /dev/null)
export DATABASE_URL="postgresql://postgres@localhost/postgres?host=$WORK&port=$PORT"
export NODE_ENV=test

cd "$ROOT"
node migrate.js
node migrate.js >/dev/null # รอบสอง: ต้องไม่รันซ้ำ

for f in "$ROOT"/db/tests/[1-9]*.sql; do
  echo "test:    $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "test:    api"
node --test test/*.test.js

echo "ALL TESTS PASSED"
