#!/usr/bin/env bash
# Restore drill: restores one backup into a new, isolated database and proves the application can use it.
# Never touches an existing database. See docs/OPERATIONS.md, "Restore drill".
#
#   restore-drill.sh <backup file>       a .dump.gpg (or, for drills on throwaway data, .unencrypted.dump)
#
#   RESTORE_ADMIN_URL   required. A role allowed to CREATE DATABASE on the drill server, connected to its maintenance
#                       database, e.g. postgresql://drill:pw@drill-host:5432/postgres. Use a separate server from
#                       production, or at least never production's own role.
#   RESTORE_DB          name of the database to create (default mlaz_restore_<timestamp>). Must start with
#                       mlaz_restore_ and must not exist yet.
#   SERVER_DIR          optional: a built API checkout (npm ci && npm run build in server/). When set, the drill also
#                       runs `prisma migrate status` and starts the API against the restored database (jobs off) to
#                       check that it answers /health and reads data through /api/public/directory.
#   RESTORE_API_PORT    port for that API (default 3999).
#   KEEP_RESTORED_DB    "true" keeps the database afterwards (to sign in by hand); otherwise it is dropped.
#
# The private backup key must be in this machine's gpg keyring to decrypt. Prints the time each step took.
set -Eeuo pipefail

FILE="${1:?usage: restore-drill.sh <backup file>}"
: "${RESTORE_ADMIN_URL:?set RESTORE_ADMIN_URL}"
DB="${RESTORE_DB:-mlaz_restore_$(date -u +%Y%m%d%H%M%S)}"
PORT="${RESTORE_API_PORT:-3999}"
[[ "$DB" =~ ^mlaz_restore_[a-z0-9_]+$ ]] || { echo "RESTORE_DB must match mlaz_restore_[a-z0-9_]+ (got $DB)" >&2; exit 2; }

START=$SECONDS
step() { printf '[%4ss] %s\n' "$((SECONDS - START))" "$*"; }
fail() { printf 'DRILL FAILED: %s\n' "$*" >&2; exit 1; }

umask 077
WORK="$(mktemp -d)"
API_PID=""
cleanup() {
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  rm -rf "$WORK"
  if [[ "${KEEP_RESTORED_DB:-false}" != "true" ]]; then
    psql "$RESTORE_ADMIN_URL" -XAtqc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# The target URL: the admin URL with its database swapped for the drill database.
TARGET_URL="$(sed -E "s#/[^/?]*(\\?|$)#/${DB}\\1#" <<<"${RESTORE_ADMIN_URL%/}")"
[[ "$TARGET_URL" == *"/${DB}"* ]] || fail "could not derive the drill database URL from RESTORE_ADMIN_URL"

step "checking the backup file"
[[ -f "$FILE" ]] || fail "no such file: $FILE"
MANIFEST="${FILE}.json"
if [[ -f "$MANIFEST" ]]; then
  want="$(sed -E 's/.*"sha256":"([0-9a-f]+)".*/\1/' "$MANIFEST")"
  have="$(sha256sum "$FILE" | awk '{print $1}')"
  [[ "$want" == "$have" ]] || fail "checksum mismatch: manifest $want, file $have"
  step "checksum matches the manifest ($have)"
else
  step "WARNING: no manifest beside the file; checksum not verified"
fi

DUMP="$WORK/restore.dump"
if [[ "$FILE" == *.gpg ]]; then
  step "decrypting"
  gpg --batch --quiet --output "$DUMP" --decrypt "$FILE" || fail "could not decrypt (is the backup private key in this keyring?)"
else
  cp "$FILE" "$DUMP"
fi
pg_restore --list "$DUMP" >/dev/null || fail "not a readable pg_dump archive"

step "creating database $DB"
exists="$(psql "$RESTORE_ADMIN_URL" -XAtc "SELECT 1 FROM pg_database WHERE datname = '$DB'")"
[[ -z "$exists" ]] || fail "database $DB already exists; the drill never restores over an existing database"
psql "$RESTORE_ADMIN_URL" -XAtqc "CREATE DATABASE \"$DB\"" >/dev/null

step "restoring"
pg_restore --dbname="$TARGET_URL" --no-owner --no-privileges --exit-on-error "$DUMP"

step "checking the restored data"
psql "$TARGET_URL" -XAt -F ' ' -c "
  SELECT 'users', count(*) FROM \"User\" UNION ALL
  SELECT 'members', count(*) FROM \"Member\" UNION ALL
  SELECT 'applications', count(*) FROM \"Application\" UNION ALL
  SELECT 'payments', count(*) FROM \"Payment\" UNION ALL
  SELECT 'documents', count(*) FROM \"Document\" UNION ALL
  SELECT 'audit entries', count(*) FROM \"AuditLog\"" | sed 's/^/        /'
LATEST="$(psql "$TARGET_URL" -XAtc 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1')"
[[ -n "$LATEST" ]] || fail "no applied migrations in the restored database"
if [[ -f "$MANIFEST" ]]; then
  grep -q "\"latestMigration\":\"$LATEST\"" "$MANIFEST" || fail "latest migration $LATEST differs from the manifest"
fi
step "latest migration: $LATEST"

if [[ -n "${SERVER_DIR:-}" ]]; then
  step "prisma migrate status"
  (cd "$SERVER_DIR" && DATABASE_URL="$TARGET_URL" npx prisma migrate status) | sed 's/^/        /' || fail "migrate status reported a problem"

  step "starting the API against the restored database (jobs off)"
  secret() { node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"; }
  (cd "$SERVER_DIR" && env DOTENV_CONFIG_PATH=/nonexistent NODE_ENV=development LOG_LEVEL=warn PORT="$PORT" HOST=127.0.0.1 \
    DATABASE_URL="$TARGET_URL" JOBS_ENABLED=false JWT_SECRET="$(secret)" DATA_ENCRYPTION_KEY="$(secret)" WEBHOOK_SECRET="$(secret)" \
    STORAGE_DRIVER=local STORAGE_DIR="$WORK/storage" UPLOAD_TMP_DIR="$WORK/uploads" SMTP_URL= SMS_DRIVER=none BUREAU_DRIVER=none \
    node dist/index.js >"$WORK/api.log" 2>&1) &
  API_PID=$!
  for _ in $(seq 1 60); do curl -fsS -m 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS -m 5 "http://127.0.0.1:${PORT}/health" >/dev/null || { cat "$WORK/api.log" >&2; fail "the API did not become ready"; }
  listed="$(curl -fsS -m 10 "http://127.0.0.1:${PORT}/api/public/directory" | tr ',' '\n' | grep -c '"number"' || true)"
  step "API ready; public directory lists $listed member(s) from the restored data"
fi

step "DRILL PASSED in $((SECONDS - START)) s (database ${DB}$([[ "${KEEP_RESTORED_DB:-false}" == "true" ]] && echo ', kept' || echo ', dropped'))"
