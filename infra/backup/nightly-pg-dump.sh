#!/usr/bin/env bash
# Nightly dump of the Seedix database only.
# Uses the dedicated role `launchpad` against the host Postgres. Not a superuser.
# Install:
#   sudo install -d -o root -g root -m 750 /srv/backups/launchpad
#   sudo install -m 750 infra/backup/nightly-pg-dump.sh /usr/local/sbin/seedix-pg-dump
#   sudo crontab -e
#   15 3 * * * /usr/local/sbin/seedix-pg-dump
# WAL archiving stays off. This dump is the only backup, and it is on the same disk.

set -euo pipefail

ROLE="${SEEDIX_PG_ROLE:-launchpad}"
DB="${SEEDIX_PG_DB:-launchpad}"
DEST="${SEEDIX_BACKUP_DIR:-/srv/backups/launchpad}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"
umask 077
pg_dump --username="$ROLE" --dbname="$DB" --format=custom --file="$DEST/${DB}-${STAMP}.dump"
find "$DEST" -name "${DB}-*.dump" -mtime +14 -delete
echo "wrote $DEST/${DB}-${STAMP}.dump"
