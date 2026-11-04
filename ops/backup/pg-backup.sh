#!/usr/bin/env bash
# Logical backup of the MLAZ PostgreSQL database: dump, verify, encrypt, copy off-site, prune, report.
# Complements (does not replace) the database host's own point-in-time recovery. See docs/OPERATIONS.md, "Backups".
#
# Runs anywhere with the PostgreSQL 17 client tools, gpg, and (for the off-site copy) the AWS CLI: the image in
# ops/backup/Dockerfile has all of them. Configuration, all from the environment:
#
#   DATABASE_URL              required. Use a read-only role made for backups, not the application's role.
#   BACKUP_GPG_RECIPIENT      required. Key id or email of the backup *public* key (imported into this runner's
#                             keyring). The private key is kept offline; the runner can write backups, never read them.
#   BACKUP_DIR                local working folder (default /var/backups/mlaz). Holds recent encrypted copies only.
#   BACKUP_RETENTION_DAYS     local copies older than this are deleted (default 7). Off-site retention is the
#                             bucket's lifecycle rule, not this script.
#   BACKUP_S3_URI             off-site destination, e.g. s3://mlaz-backups/db (optional, but required in production).
#   BACKUP_S3_ENDPOINT        for S3-compatible storage other than AWS (optional).
#   BACKUP_ALERT_WEBHOOK      URL that receives a JSON POST when a backup fails (optional).
#   BACKUP_HEARTBEAT_URL      URL fetched after every successful backup, for a dead-man's-switch monitor (optional).
#   BACKUP_ALLOW_UNENCRYPTED  "true" skips encryption: restore drills on throwaway data only, never production.
#
# AWS credentials come from the usual AWS_* variables or the runner's role; use a key that may only write (PutObject)
# to the backup prefix, never delete. Exit status 0 only when the backup was dumped, verified, encrypted and copied.
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/mlaz}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="mlaz-${STAMP}"
STEP="starting"

log() { printf '%s backup %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

alert() {
  local message="$1"
  log "FAILED during ${STEP}: ${message}"
  if [[ -n "${BACKUP_ALERT_WEBHOOK:-}" ]]; then
    curl -fsS -m 20 -X POST -H 'content-type: application/json' \
      --data "{\"source\":\"mlaz-backup\",\"status\":\"failed\",\"step\":\"${STEP}\",\"backup\":\"${NAME}\",\"message\":\"${message//\"/\'}\"}" \
      "$BACKUP_ALERT_WEBHOOK" >/dev/null || log "could not deliver the failure alert"
  fi
}
trap 'alert "command failed (exit $?) at line ${LINENO}"' ERR

[[ -n "${DATABASE_URL:-}" ]] || { STEP="configuration"; alert "DATABASE_URL is not set"; exit 2; }
if [[ "${BACKUP_ALLOW_UNENCRYPTED:-false}" != "true" && -z "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  STEP="configuration"; alert "BACKUP_GPG_RECIPIENT is not set (backups are encrypted)"; exit 2
fi

umask 077 # nothing this script writes is readable by other users
mkdir -p "$BACKUP_DIR"
DUMP="${BACKUP_DIR}/${NAME}.dump"
cleanup() { rm -f "$DUMP"; } # the unencrypted dump never outlives the script
trap cleanup EXIT

STEP="dump"
log "dumping to ${DUMP}"
# Custom format: compressed, and restorable table by table. Without owners and grants, so it restores into any role.
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=6 --no-owner --no-privileges --file="$DUMP"

STEP="verify"
# The archive must be readable and contain the application's tables and its migration history.
TOC="$(pg_restore --list "$DUMP")"
# (pg_restore --list prints e.g. "3851; 0 16802 TABLE DATA public AuditLog mlaz".)
for table in _prisma_migrations User Member Payment Document AuditLog; do
  grep -qE "TABLE DATA public ${table}( |$)" <<<"$TOC" || { alert "the dump has no data section for ${table}"; exit 1; }
done
MIGRATION="$(psql "$DATABASE_URL" -XAtc 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1')"
PG_VERSION="$(pg_dump --version | awk '{print $3}')" # "pg_dump (PostgreSQL) 17.11 (Debian ...)"

STEP="encrypt"
if [[ "${BACKUP_ALLOW_UNENCRYPTED:-false}" == "true" ]]; then
  OUT="${DUMP%.dump}.unencrypted.dump"
  mv "$DUMP" "$OUT"
  log "WARNING: not encrypted (BACKUP_ALLOW_UNENCRYPTED=true)"
else
  OUT="${DUMP}.gpg"
  gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --output "$OUT" --encrypt "$DUMP"
  rm -f "$DUMP"
fi
SHA="$(sha256sum "$OUT" | awk '{print $1}')"
SIZE="$(stat -c %s "$OUT")"
MANIFEST="${OUT}.json"
printf '{"file":"%s","createdAt":"%s","sizeBytes":%s,"sha256":"%s","latestMigration":"%s","pgDump":"%s","encrypted":%s}\n' \
  "$(basename "$OUT")" "$(date -u +%FT%TZ)" "$SIZE" "$SHA" "$MIGRATION" "$PG_VERSION" \
  "$([[ "$OUT" == *.gpg ]] && echo true || echo false)" >"$MANIFEST"

STEP="upload"
if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  endpoint=(); [[ -n "${BACKUP_S3_ENDPOINT:-}" ]] && endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  # The manifest goes last: its presence means the backup beside it is complete.
  aws "${endpoint[@]}" s3 cp --only-show-errors "$OUT" "${BACKUP_S3_URI%/}/$(basename "$OUT")"
  aws "${endpoint[@]}" s3 cp --only-show-errors "$MANIFEST" "${BACKUP_S3_URI%/}/$(basename "$MANIFEST")"
  log "copied off-site to ${BACKUP_S3_URI}"
else
  log "WARNING: BACKUP_S3_URI not set; this backup exists on this machine only"
fi

STEP="prune"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'mlaz-*' -mtime "+${RETENTION_DAYS}" -print -delete | sed 's/^/pruned /' >&2 || true

STEP="report"
log "ok ${OUT} (${SIZE} bytes, sha256 ${SHA}, migration ${MIGRATION})"
if [[ -n "${BACKUP_HEARTBEAT_URL:-}" ]]; then
  curl -fsS -m 20 "$BACKUP_HEARTBEAT_URL" >/dev/null || log "could not reach the heartbeat URL"
fi
printf '%s\n' "$OUT"
