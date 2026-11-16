#!/usr/bin/env bash
# Fails (exit 1, and alerts) when the newest complete backup is older than BACKUP_MAX_AGE_HOURS (default 26, one daily
# backup plus slack). Run it on a schedule from somewhere other than the backup runner, so a dead runner is noticed.
#
#   BACKUP_S3_URI / BACKUP_S3_ENDPOINT   where pg-backup.sh copies backups (checked when set), or
#   BACKUP_DIR                           a local backup folder (default /var/backups/mlaz)
#   BACKUP_ALERT_WEBHOOK                 receives a JSON POST when the check fails (optional)
#
# A backup counts as complete when its manifest (.json) exists: pg-backup.sh writes the manifest last.
set -Eeuo pipefail

MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"

alert() {
  echo "BACKUP CHECK FAILED: $1" >&2
  if [[ -n "${BACKUP_ALERT_WEBHOOK:-}" ]]; then
    curl -fsS -m 20 -X POST -H 'content-type: application/json' \
      --data "{\"source\":\"mlaz-backup-check\",\"status\":\"failed\",\"message\":\"${1//\"/\'}\"}" "$BACKUP_ALERT_WEBHOOK" >/dev/null || true
  fi
  exit 1
}

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  endpoint=(); [[ -n "${BACKUP_S3_ENDPOINT:-}" ]] && endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  # `aws s3 ls` prints "date time size name"; names carry a sortable UTC timestamp.
  newest="$(aws "${endpoint[@]}" s3 ls "${BACKUP_S3_URI%/}/" | awk '{print $4}' | grep -E '^mlaz-[0-9]{8}T[0-9]{6}Z\..*\.json$' | sort | tail -n 1 || true)"
else
  newest="$(find "${BACKUP_DIR:-/var/backups/mlaz}" -maxdepth 1 -name 'mlaz-*.json' -printf '%f\n' 2>/dev/null | sort | tail -n 1 || true)"
fi
[[ -n "$newest" ]] || alert "no complete backup found"

stamp="$(sed -E 's/^mlaz-([0-9]{8})T([0-9]{2})([0-9]{2})([0-9]{2})Z.*/\1 \2:\3:\4/' <<<"$newest")"
age_hours=$(( ($(date -u +%s) - $(date -u -d "$stamp" +%s)) / 3600 ))
(( age_hours <= MAX_AGE_HOURS )) || alert "newest backup ${newest} is ${age_hours} h old (limit ${MAX_AGE_HOURS} h)"
echo "ok: newest backup ${newest} is ${age_hours} h old"
