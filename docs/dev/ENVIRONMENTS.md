# Environments and deploys

Compose files, VPS instances, the demo's scheduled reset, Keycloak.\
Moved from CLAUDE.md as it was; CLAUDE.md keeps the rules that apply everywhere and points here.

- Environments: `compose/docker-compose.{dev,local,vps}.yml`; `local` uses `infra/caddy/Caddyfile.local`, `vps` the shared edge in `infra/caddy/edge/`.\
  Azure is `infra/azure/provision.sh` (no compose file).\
  `vps` and `azure` deploy only through GitHub Actions, with config in GitHub Environments (`azure`, and one per VPS instance: `prod`, `preprod`, `test`, ...).\
  A VPS GitHub Environment is one instance: its name sets the container prefix, `/opt/apensum-<env>`, its own Postgres, and `DOMAIN` + `WEB_SUB/API_SUB/AUTH_SUB` (optional `MAIL_SUB` for the Mailpit inbox, `PORTAINER_SUB` for Portainer, default `portainer`) set its hostnames.\
  `VPS_HOST/USER` are variables, `VPS_SSH_KEY` a secret.\
  Never hand-edit files on the server; change `infra/vps/remote.sh` or `infra/caddy/edge/`.\
  `deploy` does not seed: use the `vps` workflow's `seed` (additive, needs `SEED <env>`), `reset-seed` (destructive) or `deploy-reset` (both in one run, the migrations once; the demo's scheduled reset takes its image from the newest `deploy` or `deploy-reset`).\
  The `demo` instance starts over every two hours (an entry in the deploy user's crontab on its server, `remote.sh` `demo_reset_timer`, installed by each deploy while `DEMO_RESET_EVERY_HOURS` is set, every hour at minute 7 but going on only in the UTC hours that are a multiple of it: `scheduled-reset` with the files and image the last deploy left (skipped when the last reset, any kind, is less than an hour old, `last-reset`), its few values in `demo-reset.env` readable by the deploy user only; `demo-reset.yml` is the manual way, `reset-seed` with the tag of demo's last successful deploy; only prod is backed up before a reset: `RESET_BACKUP=false` is set on demo, preprod and test; unset = backup, the newest 10 kept).\
  `DEMO_RESET_EVERY_HOURS=2` (demo's Environment) makes `GET health` report the schedule; the web app (`DemoResetNotice.tsx`, times in `demoReset.ts`, a test keeps the cron in step) warns 10 minutes ahead and, while the API is away around a scheduled time, shows a waiting page that reloads when it is back.\
  Every instance but prod shows a box after the app bar's title with its name (Development, Local, Test, Demo, Preprod; `InstanceInfo.tsx`, `GET health` `instance` from `INSTANCE`: `remote.sh` sets the GitHub Environment's name, `scripts/with-env.mjs` and the VS Code API launch `development`/`local`, the local compose file `local`), on hover its last delivery (`DEPLOYED_AT`, which `remote.sh` writes into `compose/.env` at `deploy` and `deploy-reset`, keeps at `reset-seed`, and a scheduled reset leaves as it is; development and local: since when the API runs); on demo a countdown to the next reset follows (hours:minutes, the colon ticking; on hover when it is).\
  The API's documents live in the `documents_data` volume (before, each deploy lost them); a reset without backup empties it.\
  `seed.sql` must stay re-runnable: fixed keys on every row, `ON CONFLICT DO NOTHING`, and UPDATEs that only fill in unset values.\
  Each VPS instance has its own Postgres container (`PG_PORT`, role/db `worktime`) and Mailpit; only Caddy is shared (`infra/caddy/edge`).\
  Portainer is its own per-server stack (`infra/portainer`, `vps` workflow action `portainer`).\
  Ports follow `8090+N` (single sign-on: Dex on dev/local), `5430+N` (pg), `3000+N` (web), `8000+N` (API).\
  Each compose file has a one-shot `migrate` service that runs before the API (and Keycloak) start.
- Keycloak realm config (`SSO_PROVIDER=keycloak`, Azure): `infra/keycloak/realm-worktime.json`; Dex on dev/local: `infra/dex/`.
