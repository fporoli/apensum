#!/usr/bin/env bash
# Runs on the VPS, called by .github/workflows/site.yml from the unpacked release (the built
# website in apps/site/dist plus infra/site). Installs the website as its own small stack at
# /opt/edge/apensum-site behind the shared edge Caddy, which must already run on this server
# (it does once any worktime3 instance was deployed there with the vps workflow).
#   SITE_DOMAIN=apensum.ch bash infra/site/remote.sh deploy
#   SITE_DOMAIN=apensum.ch bash infra/site/remote.sh remove
set -euo pipefail

ACTION="${1:-deploy}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DIR=/opt/edge/apensum-site
EDGE=/opt/edge
SITE_FILE="$EDGE/sites/apensum-site.caddy"
DOMAIN="${SITE_DOMAIN:?SITE_DOMAIN is required}"
KEEP=3

if ! printf '%s' "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo "Invalid SITE_DOMAIN: $DOMAIN" >&2
  exit 1
fi

caddy_reload() {
  docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
  docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
}

deploy() {
  if ! docker inspect edge-caddy >/dev/null 2>&1; then
    echo "The shared edge Caddy (edge-caddy) is not running on this server. Deploy a worktime3 instance here first (vps workflow)." >&2
    exit 1
  fi
  [ -f "$SRC/apps/site/dist/index.html" ] || { echo "No built website in the release." >&2; exit 1; }

  mkdir -p "$DIR/www/releases"
  cp "$SRC/infra/site/docker-compose.yml" "$SRC/infra/site/Caddyfile" "$DIR/"
  # The contact form's target (SITE_CONTACT_URL, built into the pages) is the only place a form may
  # post to: its origin goes into the CSP form-action, 'none' without a form.
  local form_action="'none'"
  if [ -n "${SITE_CONTACT_URL:-}" ]; then
    form_action="$(printf '%s' "$SITE_CONTACT_URL" | sed -E 's#^(https://[A-Za-z0-9.-]+(:[0-9]+)?).*$#\1#')"
    case "$form_action" in https://*) ;; *) echo "Invalid SITE_CONTACT_URL: $SITE_CONTACT_URL" >&2; exit 1 ;; esac
    case "$form_action" in */*/*/*) echo "Invalid SITE_CONTACT_URL: $SITE_CONTACT_URL" >&2; exit 1 ;; esac
  fi
  printf 'SITE_FORM_ACTION="%s"\n' "$form_action" > "$DIR/.env"

  # New release next to the old ones, then switch the `current` link in one step: requests are
  # served from either the old or the new tree, never from a half-copied one.
  local id
  id="$(date -u +%Y%m%d%H%M%S)"
  cp -R "$SRC/apps/site/dist" "$DIR/www/releases/$id"
  ln -sfn "releases/$id" "$DIR/www/current.tmp"
  mv -Tf "$DIR/www/current.tmp" "$DIR/www/current"

  # Recreated when SITE_FORM_ACTION changed.
  (cd "$DIR" && docker compose up -d)
  # The Caddyfile is a bind mount: compose does not notice a changed file, so reload it.
  docker exec apensum-site caddy reload --config /etc/caddy/Caddyfile >/dev/null

  sed "s/__SITE_HOST__/$DOMAIN/g" "$SRC/infra/site/apensum-site.caddy.tpl" > "$SITE_FILE"
  caddy_reload

  # Keep the last few releases for a quick manual rollback (re-point `current`).
  ls -1d "$DIR/www/releases/"*/ 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf
  echo "Website $DOMAIN deployed (release $id)."
}

remove() {
  if [ -f "$DIR/docker-compose.yml" ]; then (cd "$DIR" && docker compose down); fi
  rm -f "$SITE_FILE"
  rm -rf "$DIR"
  if docker inspect edge-caddy >/dev/null 2>&1; then caddy_reload; fi
  echo "Website removed."
}

case "$ACTION" in
  deploy) deploy ;;
  remove) remove ;;
  *) echo "Usage: remote.sh deploy|remove" >&2; exit 1 ;;
esac
