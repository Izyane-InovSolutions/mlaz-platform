# Backup runner: the PostgreSQL 17 client tools (same major version as the server, so dumps restore cleanly), gpg for
# encryption, curl for alerts and heartbeats, the AWS CLI for the off-site copy, and Node for the restore drill's
# application check. Schedule it with whatever the host offers (cron, a Kubernetes CronJob, a scheduled container).
#
#   docker build -t mlaz-backup ops/backup
#   docker run --rm -e DATABASE_URL=... -e BACKUP_GPG_RECIPIENT=... -e BACKUP_S3_URI=... \
#     -v /path/to/backup-public-key.asc:/keys/backup.asc:ro mlaz-backup
FROM node:24-bookworm-slim AS node

FROM postgres:17-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends gnupg curl ca-certificates awscli \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY pg-backup.sh restore-drill.sh check-backup-freshness.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/pg-backup.sh /usr/local/bin/restore-drill.sh /usr/local/bin/check-backup-freshness.sh
USER postgres
WORKDIR /var/lib/postgresql
ENV BACKUP_DIR=/var/lib/postgresql/backups
# Imports the mounted public key (if any), then backs up. Override the command for the drill or the freshness check.
CMD ["bash", "-c", "if [ -f /keys/backup.asc ]; then gpg --batch --quiet --import /keys/backup.asc; fi; exec pg-backup.sh"]
