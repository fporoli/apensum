#!/usr/bin/env bash
# Runs ON the VPS, sent over SSH by .github/workflows/backup.yml (`ssh vps "bash -s -- <args>" < backup.sh`).
# Nothing unencrypted leaves the server: the dump and the documents are encrypted with the backup's age
# public key while they are read, and only the ciphertext goes to stdout. The private key comes to the
# server only for `verify` and `restore`, as a file in the work folder, removed when the script ends.
#
#   backup.sh <env> dump <age-recipient>        the whole database (pg_dump, custom format), encrypted, to stdout
#   backup.sh <env> documents <age-recipient>   the documents volume (tar), encrypted, to stdout
#   backup.sh <env> verify <dir>                restores <dir>/db.dump.age into a scratch database, checks it,
#                                               drops it, and reads <dir>/documents.tar.age through (key: <dir>/key)
#   backup.sh <env> restore <dir>               replaces the instance's database and documents with the backup;
#                                               the database before it is kept as worktime_before_<time>, the
#                                               documents as a tar in ~/apensum-<env>-db-backups
# Logs go to stderr (stdout is the backup); they are public in the workflow run, so they hold no data.
set -euo pipefail

slug="$(printf '%s' "${1:?environment required}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | sed 's/-*$//')"
action="${2:?action required}"
arg="${3:?argument required}"
PREFIX="apensum-$slug"
PG="$PREFIX-pg"
DOCS_VOLUME="${PREFIX}_documents_data"
HELPER=alpine:3.20   # reads and writes the documents volume, whether the API runs or not

log() { echo "$*" >&2; }

ensure_age() {
  command -v age >/dev/null && return 0
  log "Installing age..."
  # Not from stdin: that is this script (ssh ... "bash -s" < backup.sh).
  if ! { sudo -n apt-get update -qq && sudo -n apt-get install -y -qq age; } </dev/null >&2; then
    log "age is missing and cannot be installed without a password: run once on the server: sudo apt-get install age"
    exit 1
  fi
}

psql_admin() { docker exec -e PGOPTIONS=--client-min-messages=warning "$PG" psql -U worktime -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }

# Restores the dump into a new database $1 (dropped first if a failed run left it).
restore_into() {
  local db="$1" dir="$2"
  psql_admin -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" -c "CREATE DATABASE \"$db\" OWNER worktime"
  age -d -i "$dir/key" "$dir/db.dump.age" | docker exec -i "$PG" pg_restore -U worktime -d "$db" --exit-on-error
  local counts
  counts="$(docker exec "$PG" psql -U worktime -d "$db" -Atqc "SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.organizations), (SELECT count(*) FROM public.databasechangelog)")"
  IFS='|' read -r users orgs changesets <<<"$counts"
  if [ "$users" -eq 0 ] || [ "$orgs" -eq 0 ] || [ "$changesets" -eq 0 ]; then
    log "The restored database is empty or incomplete."
    exit 1
  fi
  log "Database restored and readable ($changesets changesets)."
}

case "$action" in
  dump)
    [[ "$arg" =~ ^age1[0-9a-z]+$ ]] || { log "not an age public key"; exit 2; }
    ensure_age
    docker exec "$PG" pg_dump -U worktime -d worktime --format=custom | age -r "$arg"
    ;;
  documents)
    [[ "$arg" =~ ^age1[0-9a-z]+$ ]] || { log "not an age public key"; exit 2; }
    ensure_age
    docker volume inspect "$DOCS_VOLUME" >/dev/null
    docker run --rm -v "$DOCS_VOLUME:/d:ro" "$HELPER" tar c -C /d . | age -r "$arg"
    ;;
  verify)
    ensure_age
    trap 'rm -rf "$arg"; psql_admin -c "DROP DATABASE IF EXISTS worktime_restore_check WITH (FORCE)" >/dev/null 2>&1 || true' EXIT
    restore_into worktime_restore_check "$arg"
    files="$(age -d -i "$arg/key" "$arg/documents.tar.age" | tar t | awk '!/\/$/ { n++ } END { print n + 0 }')"
    log "Documents archive readable ($files files)."
    ;;
  restore)
    ensure_age
    trap 'rm -rf "$arg"' EXIT
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    # Restored next to the live database first, so a broken backup never replaces it.
    restore_into worktime_restoring "$arg"
    age -d -i "$arg/key" "$arg/documents.tar.age" | tar t >/dev/null

    keep="$HOME/$PREFIX-db-backups"
    mkdir -p "$keep"
    docker run --rm -v "$DOCS_VOLUME:/d:ro" "$HELPER" tar c -C /d . > "$keep/documents-before-restore-$stamp.tar"
    log "Documents before the restore saved to $keep/documents-before-restore-$stamp.tar"

    docker stop "$PREFIX-api" "$PREFIX-keycloak" >/dev/null
    trap 'rm -rf "$arg"; docker start "$PREFIX-keycloak" "$PREFIX-api" >/dev/null || true' EXIT
    # The previous database stays as worktime_before_<time> (older ones of those are dropped).
    for old in $(psql_admin -c "SELECT datname FROM pg_database WHERE datname LIKE 'worktime\_before\_%'"); do
      psql_admin -c "DROP DATABASE \"$old\" WITH (FORCE)"
    done
    psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'worktime' AND pid <> pg_backend_pid()" >/dev/null
    psql_admin -c "ALTER DATABASE worktime RENAME TO \"worktime_before_$stamp\"" -c "ALTER DATABASE worktime_restoring RENAME TO worktime"
    log "Database replaced; the one before is kept as worktime_before_$stamp."

    docker run --rm -v "$DOCS_VOLUME:/d" "$HELPER" sh -c 'find /d -mindepth 1 -delete'
    age -d -i "$arg/key" "$arg/documents.tar.age" | docker run --rm -i -v "$DOCS_VOLUME:/d" "$HELPER" tar x -C /d
    log "Documents replaced."
    ;;
  *) log "usage: backup.sh <env> dump|documents <age-recipient> | verify|restore <dir>"; exit 2 ;;
esac
