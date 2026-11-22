#!/usr/bin/env bash
# Runs ON the VPS. Shipped from the repo by .github/workflows/vps.yml, which also supplies
# the secrets and variables of the chosen GitHub Environment as environment variables.
# Nothing on the server is edited by hand and there is no git checkout there.
#
#   remote.sh deploy        edge stack (Caddy), then this instance
#                           (own Postgres and Mailpit, migrate, api, web, Keycloak), then reload Caddy
#   remote.sh seed          loads the demo data into the running instance, adding only what is
#                           missing (seed.sql is additive; nothing is dropped or overwritten)
#   remote.sh reset-seed    backs up and drops the public schema, migrates, loads the demo data
#   remote.sh portainer     (re)deploys Portainer, one per server, in its own stack
#   remote.sh destroy       removes this instance entirely (a final dump is kept in $HOME)
#
# One GitHub Environment = one instance. Everything instance-specific derives from its name
# (ENVIRONMENT), its hostnames (DOMAIN + WEB_SUB/API_SUB/AUTH_SUB) and its Postgres port
# (PG_PORT), so several instances (production, preprod, test, ...) can share a server: each
# gets its own containers (apensum-<env>-*), Compose project, /opt/apensum-<env>,
# Postgres and Caddy site.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # the files just shipped
EDGE=/opt/edge

slug="$(printf '%s' "${ENVIRONMENT:?required}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | sed 's/-*$//')"
PREFIX="apensum-$slug"
LEGACY_DB="worktime_${slug//-/_}"   # only used by `destroy`, for databases on the removed shared edge-pg
ROOT="/opt/$PREFIX"
PG="$PREFIX-pg"
WEB_HOST="${WEB_SUB:?required}.${DOMAIN:?required}"
API_HOST="${API_SUB:?required}.$DOMAIN"
AUTH_HOST="${AUTH_SUB:?required}.$DOMAIN"
: "${PG_PORT:?required}"
COMPOSE=(docker compose -p "$PREFIX" -f "$ROOT/compose/docker-compose.vps.yml")

# Creates a directory owned by the deploy user. /opt belongs to root, so a new instance's
# directory needs sudo once (passwordless, as for `ubuntu` on cloud images); else say what to run.
own_dir() {
  [ -d "$1" ] && return 0
  mkdir -p "$1" 2>/dev/null && return 0
  if sudo -n install -d -o "$(id -un)" -g "$(id -gn)" "$1" 2>/dev/null; then return 0; fi
  echo "Cannot create $1: run once on the server: sudo install -d -o $(id -un) $1" >&2
  exit 1
}

# Copies the shipped files into this instance's directory. compose/.env is left alone.
install_files() {
  own_dir "$ROOT"
  mkdir -p "$ROOT/compose" "$ROOT/rendered"
  rm -rf "$ROOT/infra"
  cp -a "$SRC/infra" "$ROOT/infra"
  cp "$SRC/compose/docker-compose.vps.yml" "$ROOT/compose/docker-compose.vps.yml"
  # Keycloak redirect URIs follow this instance's web host.
  sed "s#https://wt\.turbotapir\.com#https://$WEB_HOST#g" \
    "$ROOT/infra/keycloak/realm-worktime.json" > "$ROOT/rendered/realm-worktime.json"
}

# Values are single-quoted so compose does not interpolate `$`; they must not contain a
# single quote. SMTP_* may be empty: the compose file falls back to the instance's Mailpit.
write_app_env() {
  export REALM_FILE="$ROOT/rendered/realm-worktime.json" CONTAINER_PREFIX="$PREFIX" \
    PG_PORT WEB_HOST API_HOST AUTH_HOST
  (
    umask 077
    for name in POSTGRES_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD API_JWT_SECRET DOCUMENTS_KEY DOCUMENTS_KEY_PREVIOUS \
      SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_PASSWORD SMTP_SECURE SHOW_DEMO_ACCOUNTS DEMO_RESET_EVERY_HOURS \
      CONTACT_SITE_ORIGINS CONTACT_EMAIL \
      REALM_FILE CONTAINER_PREFIX PG_PORT WEB_HOST API_HOST AUTH_HOST; do
      printf "%s='%s'\n" "$name" "$(printenv "$name" || true)"
    done > "$ROOT/compose/.env"
  )
  export API_IMAGE="ghcr.io/$REPO/api:$IMAGE_TAG" WEB_IMAGE="ghcr.io/$REPO/web:$IMAGE_TAG"
}

edge_up() {
  docker network inspect edge >/dev/null 2>&1 || docker network create edge
  own_dir "$EDGE"; mkdir -p "$EDGE/sites"
  cp "$ROOT/infra/caddy/edge/docker-compose.yml" "$ROOT/infra/caddy/edge/Caddyfile" "$EDGE/"
  # This instance's site file is rendered from its three hostnames. Only files this run owns
  # are replaced, so other instances' sites (and portainer.caddy) stay.
  # Tools that moved into each instance (Adminer, Mailpit): drop what older deploys left.
  rm -f "$EDGE/sites/db.caddy" "$EDGE/sites/mail.caddy"
  docker rm -f edge-adminer mailpit >/dev/null 2>&1 || true
  sed -e "s/__WEB_HOST__/$WEB_HOST/g" -e "s/__API_HOST__/$API_HOST/g" \
      -e "s/__AUTH_HOST__/$AUTH_HOST/g" -e "s/__PREFIX__/$PREFIX/g" \
    "$ROOT/infra/caddy/edge/sites/worktime3.caddy.tpl" > "$EDGE/sites/$PREFIX.caddy"
  # Optional inbox UI of this instance's Mailpit, at MAIL_SUB.DOMAIN (needs a DNS record).
  if [ -n "${MAIL_SUB:-}" ]; then
    local mail_pw="${MAILPIT_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-admin}}"
    local mail_hash=""
    if docker inspect edge-caddy >/dev/null 2>&1; then
      mail_hash="$(docker exec edge-caddy caddy hash-password --plaintext "$mail_pw" 2>/dev/null || true)"
    fi
    if [ -z "$mail_hash" ]; then
      mail_hash="$(docker run --rm caddy:2 caddy hash-password --plaintext "$mail_pw" 2>/dev/null || true)"
    fi
    if [ -z "$mail_hash" ]; then
      # Fallback bcrypt hash of plaintext "admin"
      mail_hash='$2y$10$bBtIOHcG3m.vS7pgWPrQNuxpDQiIPA28JEp0d7ebT8X2iP0k1RhPe'
    fi
    sed -e "s/__MAIL_HOST__/$MAIL_SUB.$DOMAIN/g" -e "s/__PREFIX__/$PREFIX/g" \
        -e "s#__MAIL_HASH__#$mail_hash#g" \
      "$ROOT/infra/caddy/edge/sites/worktime3-mail.caddy.tpl" >> "$EDGE/sites/$PREFIX.caddy"
  fi
  # No --remove-orphans: a leftover legacy `edge-pg` (the old shared Postgres) is not part of
  # this stack any more; remove it yourself with `docker rm -f edge-pg` when nothing needs it.
  (cd "$EDGE" && docker compose up -d)
}

# Portainer: one per server, its own stack in $EDGE/portainer, independent of every instance.
portainer_up() {
  local dir="$EDGE/portainer" owner
  docker network inspect edge >/dev/null 2>&1 || docker network create edge
  mkdir -p "$dir" "$EDGE/sites"
  cp "$SRC/infra/portainer/docker-compose.yml" "$dir/docker-compose.yml"
  # Hostname is PORTAINER_SUB.DOMAIN (PORTAINER_SUB defaults to "portainer"): servers sharing a
  # DOMAIN need different names, since each name's DNS record points at one server.
  local host="${PORTAINER_SUB:-portainer}.$DOMAIN"
  sed "s/__PORTAINER_HOST__/$host/g" "$SRC/infra/portainer/portainer.caddy" > "$EDGE/sites/portainer.caddy"
  ( umask 077; printf "PORTAINER_HOST='%s'\n" "$host" > "$dir/.env" )
  # Adopt the container the old edge stack ran: same name, its data volume is reused.
  owner="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' portainer 2>/dev/null || true)"
  if [ -n "$owner" ] && [ "$owner" != portainer ]; then docker rm -f portainer >/dev/null; fi
  (cd "$dir" && docker compose up -d)
  if docker inspect edge-caddy >/dev/null 2>&1; then caddy_reload; fi
}

portainer_remove() {
  local dir="$EDGE/portainer"
  if [ -f "$dir/docker-compose.yml" ]; then (cd "$dir" && docker compose down); fi
  docker rm -f portainer >/dev/null 2>&1 || true
  rm -f "$EDGE/sites/portainer.caddy"
  rm -rf "$dir"
  if docker inspect edge-caddy >/dev/null 2>&1; then caddy_reload; fi
  echo "Portainer removed (its data volume edge_portainer_data is kept)."
}

# Starts this instance's Postgres and waits until it accepts connections.
pg_up() {
  "${COMPOSE[@]}" up -d pg
  local i
  for i in $(seq 1 60); do
    docker exec "$PG" pg_isready -U worktime -d worktime >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "$PG did not become ready" >&2
  exit 1
}

ghcr_login() {
  [ -z "${GHCR_TOKEN:-}" ] && return 0
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:?GHCR_USERNAME is required with GHCR_TOKEN}" --password-stdin
}

caddy_reload() {
  docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
  docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
}

deploy() {
  install_files
  write_app_env
  ghcr_login
  edge_up
  pg_up
  # api/web are pre-built images (no `build:` context), so `--build` below only rebuilds
  # migrate's local Dockerfile; it never re-pulls api/web from GHCR. Without this explicit
  # pull, `up` reuses whatever is cached under the same tag and runs stale code.
  "${COMPOSE[@]}" pull api web
  carry_documents_out
  "${COMPOSE[@]}" up -d --build --remove-orphans
  carry_documents_in
  caddy_reload
  if is_public_demo; then
    docker exec "$PG" psql -U worktime -d worktime --no-psqlrc --set=ON_ERROR_STOP=1 -c "$DEMOTE_DEMO_ADMIN"
  fi
}

# Documents used to live inside the API container (no volume), so each deploy lost them. The first deploy
# with the documents_data volume copies what the running container still holds into it; once the volume is
# in place this does nothing.
DOCS_PATH=/app/apps/api/data/documents
carry_documents_out() {
  rm -rf "$ROOT/documents-carry"
  docker inspect "$PREFIX-api" >/dev/null 2>&1 || return 0
  if docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$PREFIX-api" | grep -q "$DOCS_PATH"; then return 0; fi
  if docker cp "$PREFIX-api:$DOCS_PATH" "$ROOT/documents-carry" 2>/dev/null; then
    echo "Carrying $(find "$ROOT/documents-carry" -type f | wc -l | tr -d ' ') document file(s) into the new documents volume"
  fi
}
carry_documents_in() {
  [ -d "$ROOT/documents-carry" ] || return 0
  docker cp "$ROOT/documents-carry/." "$PREFIX-api:$DOCS_PATH/"
  rm -rf "$ROOT/documents-carry"
}

# The public demo (DEMO_RESET_EVERY_HOURS set) publishes its Admin login, so that account is no
# superdeveloper there: visitors can't switch licensed modules or edit what applies to every organization.
# seed.sql sets the flag for the other environments, so it is taken back with each seed and deploy.
DEMOTE_DEMO_ADMIN="UPDATE public.users SET is_superdeveloper = false WHERE id = '11111111-1111-1111-1111-111111111111' AND is_superdeveloper"
is_public_demo() {
  [ "${DEMO_RESET_EVERY_HOURS:-0}" -gt 0 ] 2>/dev/null
}

# Loads seed.sql, then each plugin's seed (infra/postgres/seeds/plugins/<id>.sql, staged by the
# workflow), in one transaction. It is additive (fixed keys, ON CONFLICT DO NOTHING), so running it
# on a populated database only adds the demo rows that are missing.
load_seed() {
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local files=("$ROOT/infra/postgres/seeds/seed.sql")
  local plugin
  for plugin in "$ROOT"/infra/postgres/seeds/plugins/*.sql; do
    [ -f "$plugin" ] && files+=("$plugin")
  done
  local args=() copied=() f target
  for f in "${files[@]}"; do
    target="/tmp/$PREFIX-seed-$stamp-$(basename "$f")"
    docker cp "$f" "$PG:$target"
    copied+=("$target")
    args+=(-f "$target")
  done
  if is_public_demo; then args+=(-c "$DEMOTE_DEMO_ADMIN"); fi
  docker exec "$PG" psql -U worktime -d worktime --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction "${args[@]}"
  docker exec "$PG" rm -f "${copied[@]}"
}

# Closes last year for the demo people (Time balances -> Year-end closing), with the API's balance logic,
# which SQL alone can't repeat (apps/api/src/cli/close-demo-years.ts). Needs the API container running.
# Best effort: the demo works without it.
close_demo_years() {
  docker exec "$PREFIX-api" node apps/api/dist/cli/close-demo-years.js || echo "WARNING: closing the demo years failed" >&2
}

# Non-destructive: needs a deployed (migrated) instance; no backup, no restart.
seed() {
  install_files
  docker inspect "$PG" >/dev/null
  load_seed
  close_demo_years
  echo "Demo data present: $(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT count(*) FROM public.users") users."
}

reset_seed() {
  install_files
  write_app_env
  ghcr_login
  docker inspect "$PG" >/dev/null
  docker inspect "$PREFIX-api" >/dev/null

  local auth_tables_before backup_dir timestamp backup_file counts i
  # Keycloak creates its auth schema on first start, which takes a while right after a deploy.
  for i in $(seq 1 60); do
    auth_tables_before="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth'")"
    [ "$auth_tables_before" -gt 0 ] && break
    [ "$i" = 1 ] && echo "Waiting for Keycloak to create its auth schema..."
    sleep 5
  done
  if [ "$auth_tables_before" -eq 0 ]; then
    echo "Keycloak has not created its auth schema after 5 minutes: see docker logs $PREFIX-keycloak" >&2
    exit 1
  fi

  # Only prod is backed up: RESET_BACKUP=false (GitHub Environment variable, set on demo, preprod and test)
  # skips it. Unset means a backup, so a new instance is safe until decided; the newest 10 are kept.
  if [ "${RESET_BACKUP:-true}" = "false" ]; then
    echo "RESET_BACKUP=false: no backup before this reset"
  else
    backup_dir="$HOME/$PREFIX-db-backups"
    mkdir -p "$backup_dir"
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_file="$backup_dir/public-before-reset-$timestamp.dump"
    # The schemas a reset drops: everything but Keycloak's `auth` (public and the plugins' own, e.g. cases, hr).
    docker exec "$PG" pg_dump -U worktime -d worktime --exclude-schema=auth --format=custom > "$backup_file"
    test -s "$backup_file"
    echo "Public-schema backup saved to $backup_file"
    ls -1t "$backup_dir"/public-before-reset-*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f --
  fi

  # Without a backup the files go as well: their rows are about to be dropped (only prod keeps them).
  if [ "${RESET_BACKUP:-true}" = "false" ]; then
    docker exec "$PREFIX-api" sh -c "find '$DOCS_PATH' -mindepth 1 -delete" 2>/dev/null || true
  fi
  docker stop "$PREFIX-api"
  # Bring the API back even if a later step fails (set -e), so a failed reset never leaves it down.
  trap 'docker start "$PREFIX-api" >/dev/null || true' EXIT
  # Every schema but Keycloak's `auth` and the system ones goes: public and the plugins' own schemas
  # (apensum.dbSchema, e.g. cases, hr), whose changesets run again (Liquibase's history is in public).
  # scripts/reset-db.mjs drops the same.
  docker exec "$PG" psql -U worktime -d worktime -v ON_ERROR_STOP=1 -c "DO \$\$ DECLARE s text; BEGIN FOR s IN SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public', 'auth', 'information_schema') AND nspname NOT LIKE 'pg\_%' LOOP EXECUTE format('DROP SCHEMA %I CASCADE', s); END LOOP; END \$\$; DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION worktime; GRANT ALL ON SCHEMA public TO public;"

  "${COMPOSE[@]}" run --rm --build --no-deps migrate

  load_seed

  # Sanity check, not exact counts (those change whenever seed.sql or the changelog grows):
  # demo users, orgs and logins exist, and Keycloak's auth schema was left untouched.
  counts="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.organizations), (SELECT count(*) FROM public.user_identities WHERE provider = 'password'), (SELECT count(*) FROM public.databasechangelog), (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth')")"
  echo "users|organizations|password identities|changesets|auth tables: $counts"
  IFS='|' read -r n_users n_orgs n_logins n_changesets n_auth <<<"$counts"
  if [ "$n_users" -eq 0 ] || [ "$n_orgs" -eq 0 ] || [ "$n_logins" -eq 0 ] || [ "$n_changesets" -eq 0 ] || [ "$n_auth" != "$auth_tables_before" ]; then
    echo "reset-seed verification failed" >&2
    exit 1
  fi

  trap - EXIT
  docker start "$PREFIX-api"
  close_demo_years
}

# Removes this instance: containers, its Postgres and volume, /opt/<prefix>, its Caddy site,
# and its legacy database/role on the old shared edge-pg if that still has them (otherwise the
# next deploy would copy the old data back). A final dump of whatever existed is left in $HOME.
# The shared edge stack (Caddy, Mailpit, Portainer) and other instances are not touched.
destroy() {
  local ts n legacy=0
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  if docker inspect "$PG" >/dev/null 2>&1; then
    docker exec "$PG" pg_dump -U worktime -d worktime --format=custom > "$HOME/$PREFIX-final-$ts.dump"
    test -s "$HOME/$PREFIX-final-$ts.dump"
    echo "Final dump saved to $HOME/$PREFIX-final-$ts.dump"
  fi
  if docker inspect edge-pg >/dev/null 2>&1 &&
     [ "$(docker exec edge-pg psql -U postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$LEGACY_DB'")" = 1 ]; then
    legacy=1
    docker exec edge-pg pg_dump -U postgres -d "$LEGACY_DB" --format=custom > "$HOME/$PREFIX-legacy-final-$ts.dump"
    test -s "$HOME/$PREFIX-legacy-final-$ts.dump"
    echo "Legacy dump saved to $HOME/$PREFIX-legacy-final-$ts.dump"
  fi

  # The site goes first, so whatever fails below leaves no route to a removed instance.
  rm -f "$EDGE/sites/$PREFIX.caddy"
  if docker inspect edge-caddy >/dev/null 2>&1; then caddy_reload; fi

  # By the Compose project's label (an exact match), not `compose down`: that needs the compose file and
  # every variable in it (API_IMAGE, ...), which destroy has no use for and a half-removed instance lacks.
  local project="label=com.docker.compose.project=$PREFIX"
  docker ps -aq --filter "$project" | xargs -r docker rm -f -v >/dev/null
  for n in web api keycloak mailpit pg; do docker rm -f "$PREFIX-$n" >/dev/null 2>&1 || true; done
  docker volume ls -q --filter "$project" | xargs -r docker volume rm >/dev/null
  docker volume rm "${PREFIX}_pg_data" "${PREFIX}_mailpit_data" "${PREFIX}_documents_data" >/dev/null 2>&1 || true
  docker network ls -q --filter "$project" | xargs -r docker network rm >/dev/null
  if [ "$legacy" = 1 ]; then
    docker exec edge-pg psql -U postgres -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$LEGACY_DB\" WITH (FORCE)" -c "DROP ROLE IF EXISTS \"$LEGACY_DB\""
  fi
  # /opt is root's: the deploy user can empty its directory there, removing it takes sudo (as own_dir).
  if ! rm -rf "$ROOT" 2>/dev/null; then
    if [ -n "$(ls -A "$ROOT")" ]; then
      echo "Cannot empty $ROOT: run on the server: sudo rm -rf $ROOT" >&2
      exit 1
    fi
    sudo -n rmdir "$ROOT" 2>/dev/null || echo "Left the empty $ROOT (no sudo); a deploy reuses it."
  fi
  echo "Instance $PREFIX removed."
}

case "${1:-}" in
  destroy) destroy ;;
  portainer) portainer_up ;;
  portainer-remove) portainer_remove ;;
  deploy) deploy ;;
  seed) seed ;;
  reset-seed) reset_seed ;;
  *) echo "usage: remote.sh deploy|seed|reset-seed|destroy|portainer|portainer-remove" >&2; exit 2 ;;
esac
