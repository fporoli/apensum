#!/usr/bin/env bash
# Runs ON the VPS. Shipped from the repo by .github/workflows/vps.yml, which also supplies
# the secrets and variables of the chosen GitHub Environment as environment variables.
# Nothing on the server is edited by hand and there is no git checkout there.
#
#   remote.sh deploy        edge stack (Caddy), then this instance
#                           (own Postgres and Mailpit, migrate, api, web, single sign-on if any), then reload Caddy
#   remote.sh seed          loads the demo data into the running instance, adding only what is
#                           missing (seed.sql is additive; nothing is dropped or overwritten)
#   remote.sh reset-seed    backs up and drops the public schema, migrates, loads the demo data
#   remote.sh deploy-reset  deploy and reset-seed in one: the new images start on the emptied database
#                           (migrations once), then the demo data
#   remote.sh scheduled-reset  reset-seed from the files and images already on the server (the demo's timer, below)
#   remote.sh portainer     (re)deploys Portainer, one per server, in its own stack
#   remote.sh destroy       removes this instance entirely (a final dump is kept in $HOME)
#
# One GitHub Environment = one instance. Everything instance-specific derives from its name
# (ENVIRONMENT), its hostnames (DOMAIN + WEB_SUB/API_SUB/AUTH_SUB) and its Postgres port
# (PG_PORT), so several instances (production, preprod, test, ...) can share a server: each
# gets its own containers (apensum-<env>-*), Compose project, /opt/apensum-<env>,
# Postgres and Caddy site.
#
# Single sign-on: SSO_PROVIDER (GitHub Environment variable) is none (default), dex or keycloak. Only the chosen
# one runs (a Compose profile), at AUTH_SUB.DOMAIN; the other's container is removed. Dex gets its config from
# here (dex_config: the instance's issuer and web host, the connectors of the secret DEX_CONNECTORS, else Dex's
# test login); Keycloak its realm file and KEYCLOAK_ADMIN(_PASSWORD).
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
SSO_PROVIDER="$(printf '%s' "${SSO_PROVIDER:-none}" | tr 'A-Z' 'a-z')"
case "$SSO_PROVIDER" in
  ''|none) SSO_PROVIDER=none; SSO_ISSUER=""; SSO_JWKS_URL="" ;;
  dex) SSO_ISSUER="https://$AUTH_HOST"; SSO_JWKS_URL="http://$PREFIX-dex:5556/keys" ;;
  keycloak)
    SSO_ISSUER="https://$AUTH_HOST/realms/worktime"
    SSO_JWKS_URL="http://$PREFIX-keycloak:8080/realms/worktime/protocol/openid-connect/certs"
    : "${KEYCLOAK_ADMIN:?required with SSO_PROVIDER=keycloak}" "${KEYCLOAK_ADMIN_PASSWORD:?required with SSO_PROVIDER=keycloak}" ;;
  *) echo "SSO_PROVIDER must be none, dex or keycloak, not '$SSO_PROVIDER'" >&2; exit 2 ;;
esac
COMPOSE_PROFILES="$([ "$SSO_PROVIDER" = none ] || echo "$SSO_PROVIDER")"
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
  dex_config
}

# Dex's config for this instance (rendered even when Dex is not chosen: the compose file names it). Its clients'
# tokens are exchanged once by the API, so its state is small (sqlite in the dex_data volume). Connectors: the
# secret DEX_CONNECTORS (a YAML list, e.g. Microsoft Entra ID through Dex's `oidc` connector), else Dex's test
# login (mockCallback: no password, a new account kilgore@kilgore.trout without organizations).
dex_config() {
  local file="$ROOT/rendered/dex.yaml" connectors
  connectors="$(printf '%s' "${DEX_CONNECTORS_B64:-}" | base64 -d 2>/dev/null || true)"
  if [ -z "$connectors" ]; then
    connectors="- type: mockCallback
  id: mock
  name: Test login"
    if [ "$SSO_PROVIDER" = dex ]; then echo "WARNING: SSO_PROVIDER=dex without DEX_CONNECTORS: Dex offers only its test login."; fi
  fi
  (
    umask 022
    {
      printf 'issuer: https://%s\n' "$AUTH_HOST"
      printf 'storage:\n  type: sqlite3\n  config:\n    file: /var/dex/dex.db\n'
      printf "web:\n  http: 0.0.0.0:5556\n  allowedOrigins: ['https://%s']\n" "$WEB_HOST"
      printf 'oauth2:\n  skipApprovalScreen: true\n'
      printf "staticClients:\n  - id: worktime-web\n    name: Apensum\n    public: true\n    redirectURIs: ['https://%s/']\n" "$WEB_HOST"
      printf 'connectors:\n'
      printf '%s\n' "$connectors" | sed 's/^/  /'
    } > "$file"
  )
}

# Removes the single sign-on containers this instance does not use (Compose leaves a service of an inactive
# profile running). Keycloak's auth schema stays in the database.
sso_prune() {
  [ "$SSO_PROVIDER" = dex ] || docker rm -f "$PREFIX-dex" >/dev/null 2>&1 || true
  [ "$SSO_PROVIDER" = keycloak ] || docker rm -f "$PREFIX-keycloak" >/dev/null 2>&1 || true
}

# Values are single-quoted so compose does not interpolate `$`; they must not contain a
# single quote. SMTP_* may be empty: the compose file falls back to the instance's Mailpit.
write_app_env() {
  export REALM_FILE="$ROOT/rendered/realm-worktime.json" DEX_CONFIG="$ROOT/rendered/dex.yaml" CONTAINER_PREFIX="$PREFIX" \
    PG_PORT WEB_HOST API_HOST AUTH_HOST SSO_PROVIDER SSO_ISSUER SSO_JWKS_URL COMPOSE_PROFILES
  (
    umask 077
    for name in POSTGRES_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD API_JWT_SECRET DOCUMENTS_KEY DOCUMENTS_KEY_PREVIOUS \
      SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_PASSWORD SMTP_SECURE SHOW_DEMO_ACCOUNTS DEMO_RESET_EVERY_HOURS DEMO_AUTO_LOGIN TWO_FACTOR \
      CONTACT_SITE_ORIGINS CONTACT_EMAIL \
      REALM_FILE DEX_CONFIG CONTAINER_PREFIX PG_PORT WEB_HOST API_HOST AUTH_HOST SSO_PROVIDER SSO_ISSUER SSO_JWKS_URL COMPOSE_PROFILES; do
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
  sed -e "s/__WEB_HOST__/$WEB_HOST/g" -e "s/__API_HOST__/$API_HOST/g" -e "s/__PREFIX__/$PREFIX/g" \
    "$ROOT/infra/caddy/edge/sites/worktime3.caddy.tpl" > "$EDGE/sites/$PREFIX.caddy"
  # The single sign-on host only when the instance has one.
  case "$SSO_PROVIDER" in
    dex) printf '%s {\n  reverse_proxy %s-dex:5556\n}\n' "$AUTH_HOST" "$PREFIX" >> "$EDGE/sites/$PREFIX.caddy" ;;
    keycloak) printf '%s {\n  reverse_proxy %s-keycloak:8080\n}\n' "$AUTH_HOST" "$PREFIX" >> "$EDGE/sites/$PREFIX.caddy" ;;
  esac
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
  sso_prune
  carry_documents_in
  caddy_reload
  ensure_operator
  demo_reset_timer
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
  docker exec "$PG" psql -U worktime -d worktime --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction "${args[@]}"
  docker exec "$PG" rm -f "${copied[@]}"
}

# The instance's own operator account (OPERATOR_EMAIL, default admin@admin.local) with the password of
# the GitHub Environment secret OPERATOR_PASSWORD: created when missing, its password set, a member of the
# Admin organization (apps/api/src/cli/operator.ts `operators ensure`). After every deploy and reset, the
# public demo included (its published demo logins are no operators), and not without the secret.
# The password reaches the container's environment only (`-e NAME` copies it from here), never a command
# line or the log.
ensure_operator() {
  [ -n "${OPERATOR_PASSWORD:-}" ] || { echo "OPERATOR_PASSWORD is not set: no operator account ensured"; return 0; }
  OPERATOR_PASSWORD="$OPERATOR_PASSWORD" docker exec -e OPERATOR_PASSWORD "$PREFIX-api" \
    node apps/api/dist/cli/operator.js operators ensure "${OPERATOR_EMAIL:-admin@admin.local}"
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

# The steps of a reset, shared by reset-seed and deploy-reset.

# Keycloak creates its auth schema on first start, which takes a while right after a deploy. Sets
# AUTH_TABLES_BEFORE (a reset never touches that schema; verify_reset checks it). Without Keycloak it only counts.
AUTH_TABLES_BEFORE=""
wait_auth_schema() {
  local i
  for i in $(seq 1 60); do
    AUTH_TABLES_BEFORE="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth'")"
    [ "$SSO_PROVIDER" != keycloak ] && return 0
    [ "$AUTH_TABLES_BEFORE" -gt 0 ] && return 0
    [ "$i" = 1 ] && echo "Waiting for Keycloak to create its auth schema..."
    sleep 5
  done
  echo "Keycloak has not created its auth schema after 5 minutes: see docker logs $PREFIX-keycloak" >&2
  exit 1
}

# Only prod is backed up: RESET_BACKUP=false (GitHub Environment variable, set on demo, preprod and test)
# skips it. Unset means a backup, so a new instance is safe until decided; the newest 10 are kept.
backup_before_reset() {
  if [ "${RESET_BACKUP:-true}" = "false" ]; then
    echo "RESET_BACKUP=false: no backup before this reset"
    return 0
  fi
  local backup_dir backup_file
  backup_dir="$HOME/$PREFIX-db-backups"
  mkdir -p "$backup_dir"
  backup_file="$backup_dir/public-before-reset-$(date -u +%Y%m%dT%H%M%SZ).dump"
  # The schemas a reset drops: everything but Keycloak's `auth` (public and the plugins' own, e.g. cases, hr).
  docker exec "$PG" pg_dump -U worktime -d worktime --exclude-schema=auth --format=custom > "$backup_file"
  test -s "$backup_file"
  echo "Public-schema backup saved to $backup_file"
  ls -1t "$backup_dir"/public-before-reset-*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f --
}

# Stops the API and drops every schema but Keycloak's `auth` and the system ones: public and the plugins' own
# schemas (apensum.dbSchema, e.g. cases, hr), whose changesets run again (Liquibase's history is in public).
# scripts/reset-db.mjs drops the same. Without a backup the documents go as well: their rows are dropped.
drop_schemas() {
  if [ "${RESET_BACKUP:-true}" = "false" ]; then
    docker exec "$PREFIX-api" sh -c "find '$DOCS_PATH' -mindepth 1 -delete" 2>/dev/null || true
  fi
  docker stop "$PREFIX-api" >/dev/null
  docker exec "$PG" psql -U worktime -d worktime -v ON_ERROR_STOP=1 -c "DO \$\$ DECLARE s text; BEGIN FOR s IN SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public', 'auth', 'information_schema') AND nspname NOT LIKE 'pg\_%' LOOP EXECUTE format('DROP SCHEMA %I CASCADE', s); END LOOP; END \$\$; DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION worktime; GRANT ALL ON SCHEMA public TO public;"
}

# Sanity check, not exact counts (those change whenever seed.sql or the changelog grows): demo users, orgs and
# logins exist, and Keycloak's auth schema was left untouched.
verify_reset() {
  local counts n_users n_orgs n_logins n_changesets n_auth
  counts="$(docker exec "$PG" psql -U worktime -d worktime -Atqc "SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.organizations), (SELECT count(*) FROM public.user_identities WHERE provider = 'password'), (SELECT count(*) FROM public.databasechangelog), (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'auth')")"
  echo "users|organizations|password identities|changesets|auth tables: $counts"
  IFS='|' read -r n_users n_orgs n_logins n_changesets n_auth <<<"$counts"
  if [ "$n_users" -eq 0 ] || [ "$n_orgs" -eq 0 ] || [ "$n_logins" -eq 0 ] || [ "$n_changesets" -eq 0 ] || [ "$n_auth" != "$AUTH_TABLES_BEFORE" ]; then
    echo "reset verification failed" >&2
    exit 1
  fi
}

reset_seed() {
  install_files
  write_app_env
  ghcr_login
  reset_steps
}

# The reset itself, on an instance whose files, compose/.env and images are in place.
reset_steps() {
  docker inspect "$PG" >/dev/null
  docker inspect "$PREFIX-api" >/dev/null
  wait_auth_schema
  backup_before_reset
  # Bring the API back even if a later step fails (set -e), so a failed reset never leaves it down.
  trap 'docker start "$PREFIX-api" >/dev/null || true' EXIT
  drop_schemas
  "${COMPOSE[@]}" run --rm --build --no-deps migrate
  load_seed
  verify_reset
  trap - EXIT
  docker start "$PREFIX-api"
  mark_reset
  ensure_operator
  close_demo_years
}

# When the instance last started over (any reset: by hand, on deploy, on the timer), for the timer to skip one
# that would come right after another.
mark_reset() { date -u +%s > "$ROOT/last-reset"; }

# The demo starts over on a schedule (GitHub Environment variable DEMO_RESET_EVERY_HOURS): a systemd timer on the
# server, every that many hours at minute 7 UTC (apps/web/src/demoReset.ts warns ahead of the same times), runs
# `scheduled-reset` with the files and images the last deploy left; it skips a reset when the last one (also one by
# hand or a deploy-reset) is less than an hour old. What it needs that compose/.env lacks (the
# instance's names, the image tag, the operator's password) is kept in demo-reset.env, readable by the deploy user
# only, like compose/.env. Without the variable a deploy removes the timer. Needs passwordless sudo (systemd units).
DEMO_RESET_MINUTE=7
demo_reset_timer() {
  local unit="$PREFIX-reset" user; user="$(id -un)"
  if [ -z "${DEMO_RESET_EVERY_HOURS:-}" ]; then
    if [ -f "/etc/systemd/system/$unit.timer" ]; then
      sudo -n systemctl disable --now "$unit.timer" >/dev/null 2>&1 || true
      sudo -n rm -f "/etc/systemd/system/$unit.timer" "/etc/systemd/system/$unit.service" && sudo -n systemctl daemon-reload || true
    fi
    rm -f "$ROOT/demo-reset.env"
    return 0
  fi
  case "$DEMO_RESET_EVERY_HOURS" in 1|2|3|4|6|8|12) ;; *) echo "DEMO_RESET_EVERY_HOURS must divide 24 (1, 2, 3, 4, 6, 8, 12)" >&2; exit 2 ;; esac
  (
    umask 077
    for name in ENVIRONMENT DOMAIN WEB_SUB API_SUB AUTH_SUB PG_PORT SSO_PROVIDER RESET_BACKUP OPERATOR_EMAIL OPERATOR_PASSWORD \
      KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD IMAGE_TAG REPO DEMO_RESET_EVERY_HOURS; do
      printf "%s=%q\n" "$name" "$(printenv "$name" || true)"
    done > "$ROOT/demo-reset.env"
  )
  if ! sudo -n true 2>/dev/null; then
    echo "WARNING: no passwordless sudo: the demo reset timer is not installed" >&2
    return 0
  fi
  sudo -n tee "/etc/systemd/system/$unit.service" >/dev/null <<EOF
[Unit]
Description=Apensum $ENVIRONMENT: start over with the demo data (remote.sh scheduled-reset)
After=docker.service

[Service]
Type=oneshot
User=$user
ExecStart=/bin/bash -c 'set -a; . $ROOT/demo-reset.env; set +a; exec bash $ROOT/infra/vps/remote.sh scheduled-reset'
TimeoutStartSec=40min
EOF
  sudo -n tee "/etc/systemd/system/$unit.timer" >/dev/null <<EOF
[Unit]
Description=Apensum $ENVIRONMENT: demo reset every $DEMO_RESET_EVERY_HOURS hours at minute $DEMO_RESET_MINUTE UTC

[Timer]
OnCalendar=*-*-* 00/$DEMO_RESET_EVERY_HOURS:0$DEMO_RESET_MINUTE:00 UTC
Persistent=false
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --now "$unit.timer" >/dev/null
  echo "Demo reset timer: $(systemctl list-timers "$unit.timer" --no-legend | awk '{print $1, $2, $3, $4}')"
}

# The timer's reset: the images and files already here (no shipped files, no pull), then the demo data.
scheduled_reset() {
  local last=0
  [ -f "$ROOT/last-reset" ] && last="$(cat "$ROOT/last-reset" 2>/dev/null || echo 0)"
  if [ $(( $(date -u +%s) - ${last:-0} )) -lt 3600 ]; then
    echo "Scheduled reset of $ENVIRONMENT skipped: the last reset was less than an hour ago ($(date -u -d "@${last}" +%H:%M 2>/dev/null || echo "$last") UTC)"
    return 0
  fi
  export API_IMAGE="ghcr.io/$REPO/api:$IMAGE_TAG" WEB_IMAGE="ghcr.io/$REPO/web:$IMAGE_TAG"
  echo "Scheduled reset of $ENVIRONMENT ($IMAGE_TAG) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  reset_steps
  echo "Scheduled reset of $ENVIRONMENT done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# Deploy and reset in one go (the demo's way): the new images are pulled while the old instance still runs,
# then the schemas are dropped and the new containers start, so the migrations run once, on the empty
# database, before the API; then the seed. An instance deployed for the first time has nothing to drop.
deploy_reset() {
  install_files
  write_app_env
  ghcr_login
  edge_up
  pg_up
  "${COMPOSE[@]}" pull api web
  if docker inspect "$PREFIX-api" >/dev/null 2>&1; then
    wait_auth_schema
    backup_before_reset
    drop_schemas
  fi
  "${COMPOSE[@]}" up -d --build --remove-orphans
  sso_prune
  [ -n "$AUTH_TABLES_BEFORE" ] || wait_auth_schema
  load_seed
  verify_reset
  mark_reset
  caddy_reload
  ensure_operator
  close_demo_years
  demo_reset_timer
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
  for n in web api dex keycloak mailpit pg; do docker rm -f "$PREFIX-$n" >/dev/null 2>&1 || true; done
  docker volume ls -q --filter "$project" | xargs -r docker volume rm >/dev/null
  docker volume rm "${PREFIX}_pg_data" "${PREFIX}_mailpit_data" "${PREFIX}_documents_data" "${PREFIX}_dex_data" >/dev/null 2>&1 || true
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
  scheduled-reset) scheduled_reset ;;
  deploy-reset) deploy_reset ;;
  *) echo "usage: remote.sh deploy|seed|reset-seed|deploy-reset|scheduled-reset|destroy|portainer|portainer-remove" >&2; exit 2 ;;
esac
