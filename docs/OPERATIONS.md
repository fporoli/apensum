# Operations

Running Apensum: single sign-on, e-mail, monitoring, backups, two-step login, the operator, deploys (VPS, moving an instance, the website, Azure, releases) and the cases interviews.\
Development, architecture and roles are in the [README](../README.md).

## Single sign-on

Optional, one identity provider per instance, chosen by the GitHub Environment variable `SSO_PROVIDER`:

| Value | What runs |
| --- | --- |
| `none` (default, also when unset) | Nothing: no SSO button, nothing at `AUTH_SUB`. |
| `dex` | [Dex](https://dexidp.io) (about 10 MB of memory), a broker to the customers' own directories (Microsoft Entra ID, Google, LDAP, ...). |
| `keycloak` | Keycloak 25 with the realm `worktime` (`infra/keycloak/realm-worktime.json`, its data in the `auth` schema), about 0.6-1 GB of memory. |

The web app asks `GET auth/sso` whether there is one and signs in there (OIDC code flow with PKCE, client `worktime-web`), then hands the ID token to `POST auth/sso/exchange` once.\
The API checks it (signature against the provider's keys, issuer, audience, at most 10 minutes old) and returns a session like a password login's: the account linked to the token's `sub`, else the one of its verified e-mail (created if there is none).\
The provider's own second step stands in for two-step login.

Dex's configuration is written by `remote.sh` on every deploy: issuer `https://<AUTH_SUB>.<DOMAIN>`, the web host as the only client, and the connectors of the secret `DEX_CONNECTORS` (a YAML list as in [Dex's connector docs](https://dexidp.io/docs/connectors/), e.g. Microsoft Entra ID through the `oidc` connector).\
Without `DEX_CONNECTORS` Dex offers only its test login (no password; it signs in as `kilgore@kilgore.trout`, a new account without organizations).\
A connector Dex cannot open (wrong tenant, secret or address) stops Dex from starting: check `docker logs apensum-<env>-dex` after changing them.\
Switching away from Keycloak removes its container; its `auth` schema stays in the database.

On dev and local, `COMPOSE_PROFILES=dex` and `SSO_PROVIDER=dex` in `.env.dev` / `.env.local` start Dex with its test login (`infra/dex/dev.yaml`, `local.yaml`; on dev also `JWT_ISSUER=http://localhost:8091`).

## Email

The API sends mail via [nodemailer](https://nodemailer.com), configured from `SMTP_HOST/PORT/FROM/USER/PASSWORD/SECURE` (see `env.example.dev.cfg`).\
Sends are best-effort: a missing or misconfigured server never fails a request.

| Environment | Where mail goes |
| --- | --- |
| `dev` | Own [Mailpit](https://github.com/axllent/mailpit) catcher: SMTP `localhost:1025`, inbox UI `:8025`. The host-run API points at it via `.env.dev`. |
| `local` | Own Mailpit: SMTP `:1026`, inbox UI `:8026` (offset so both can run at once). The `api` container is wired to it in the compose file. |
| `vps` | Without `SMTP_HOST`, the instance's own Mailpit (`apensum-<env>-mailpit`). Set `MAIL_SUB` to publish its inbox at `<MAIL_SUB>.<DOMAIN>` behind basic auth (user `admin`). |
| `azure` | `SMTP_HOST` is unset by default, so mail silently no-ops. See below to use a real relay. |

Mailpit has no auth and nothing real is sent.

**Real relay (e.g. on Azure):** set `SMTP_HOST/PORT/FROM/USER` as environment variables and `SMTP_PASSWORD` as a secret (plus `SMTP_SECURE=true` for an implicit-TLS relay, typically port 465). nodemailer negotiates STARTTLS/AUTH itself, so any standard relay (SES, SendGrid, Mailgun, etc.) works without code changes.

**Endpoints that trigger mail or account flows**

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/auth/register` | Welcome mail |
| `POST /api/v1/organizations/:id/invite` | Org-invite mail |
| `POST /api/v1/auth/reset` | Forgot password: mails a 30-minute, one-time link if the address has a password login (always `ok`) |
| `POST /api/v1/auth/reset/confirm` | Sets the new password from that link's token |

## Monitoring

Outside: `.github/workflows/monitor.yml` checks every 10 minutes the targets in the repository variable `MONITOR_TARGETS` (a JSON list of `{ id, url, kind: health | page }`: each instance's `GET health`, its web app, the websites) and their TLS certificates (`scripts/monitor.mjs`, logic in `scripts/monitor-lib.mjs`).\
A check failing twice in a row (20 minutes, so a demo reset or a blip mails nobody), its recovery and a certificate within 14 days of its end are mailed to `OPERATOR_EMAIL` of the `prod` environment (else prod's sender address) through prod's SMTP; the state between runs is in the Actions cache.\
The check job holds no secret and its public log shows only public addresses and ok/failed; the alert job uses the `prod` environment only when there is something to send.\
GitHub runs scheduled workflows best effort: a frequent schedule is thinned out under load, at times to a few runs a day, so this is a second line only.\
For timely alerts an outside uptime service (UptimeRobot, Better Stack, ...) checks every few minutes by HTTP status alone: `GET health/db` (public) answers 200 while the instance's database answers `SELECT 1` within 3 seconds and 503 otherwise, with nothing more than `{ status }`; `GET health` answers 200 whenever the API runs, and Caddy answers 502 when the container is down.\
UptimeRobot (set up 2026-11-26, account of the operator address, alerts by mail and by push to its phone app) checks every 5 minutes, by HTTP status (keyword checks are not in the free plan, which allows 5 monitors): prod's `api.apensum.ch/api/v1/health/db` and `app.apensum.ch`, the website `apensum.ch`, the demo's `appdemo.apensum.ch` (its web app only: the demo's API is away for a minute at each scheduled reset) and preprod's `apidemo.apensum.ch/api/v1/health/db`, which stands in for the server; test and the website preview are left to `monitor.yml`.\
A new instance or host is added there by hand.\
The API and web containers restart with Docker (`restart: unless-stopped`), e.g. after an upgrade of docker-ce, and a connection that Postgres drops is only logged (`db.service.ts`), never the end of the process.

Inside: the API (`monitor.service.ts`, every hour, `MONITOR=off` disables it) reports to the operators (and, with `NTFY_TOPIC_URL`, to the operator's phone), by mail and as a notification in the Admin organization, at most once a day each: free disk space under 10 % or 2 GB (also shown under Super Admin → Instance) and a failing mail relay (as a notification only, since mail does not get through then).

## Backups

`.github/workflows/backup.yml` backs up a VPS instance every night at 01:30 UTC and every hour from 04:00 to 19:00 UTC, so at most an hour of work is lost (prod; an environment without `BACKUP_S3_ENDPOINT` is skipped): the whole database (`pg_dump`, Keycloak's `auth` schema included) and the documents volume, as two objects `<stamp>-db.dump.age` and `<stamp>-documents.tar.age` under `BACKUP_PATH/<environment>/` in an S3-compatible bucket (e.g. MinIO on another server).\
On the server (`infra/vps/backup.sh`, sent over SSH) both are encrypted with the [age](https://age-encryption.org) public key `BACKUP_AGE_RECIPIENT` while they are read: the runner and the storage see only ciphertext, and nothing on the server can decrypt it.\
The runner moves the files (AWS CLI, path-style addressing); the server has no key for the storage, so a compromised server can't delete the backups.\
Kept: every backup of the 48 hours before the newest, then the newest of each of the 7 newest days, 4 newest weeks and 12 newest months (`scripts/backup-retention.mjs`).\
A backup does not stop the instance: `pg_dump` reads a consistent snapshot while people work.\
A failed run is mailed to `OPERATOR_EMAIL` (else the sender address) through the environment's SMTP.

On the 1st of each month the workflow tests the newest backup (`verify`): it restores it into a scratch database on the server, checks it and drops it, and reads the documents archive through.\
`restore` (manual, confirmation `RESTORE <environment>`, from main) replaces the instance's database and documents with a backup (input `backup` = its stamp, empty = the newest): restored next to the live database first, then swapped while the API and Keycloak are stopped; the database before stays as `worktime_before_<time>` (the next restore drops it), the documents before as a tar in `~/apensum-<env>-db-backups`.\
A backup of an older version is brought up to date by the next `deploy` (its migrations).\
The documents stay encrypted with `DOCUMENTS_KEY` inside the backup: a restore needs that key too.\
`verify` and `restore` send the private key to the server for the run only.\
There is no restore of one organization (its rows hang together with everyone's): restore a backup into a scratch database, look up what is needed and enter it again.

Setup, once per environment (keys made on your own computer, never pasted anywhere but GitHub and the storage).\
The storage belongs on another server than the instance, its API (MinIO: port 9000) behind TLS, its console (9001) not open to the internet.\
On the storage, a bucket and a user that may use only that bucket (MinIO client `mc`):

```sh
mc alias set backup https://<host>:9000 <root user>      # asks for the root password
mc mb backup/apensum-backups
cat > apensum-backup-policy.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"], "Resource": ["arn:aws:s3:::apensum-backups"] },
  { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::apensum-backups/*"] } ] }
EOF
mc admin policy create backup apensum-backup apensum-backup-policy.json
mc admin user add backup apensum-backup                 # asks for its secret key (a long random one)
mc admin policy attach backup apensum-backup --user apensum-backup
```

Then in GitHub:

```sh
age-keygen -o apensum-backup.age          # prints the public key (age1...); keep the file in a password manager
gh secret set BACKUP_AGE_KEY --env prod < apensum-backup.age
gh variable set BACKUP_AGE_RECIPIENT --env prod --body age1...
gh variable set BACKUP_S3_ENDPOINT --env prod --body https://<host>:9000
gh variable set BACKUP_S3_BUCKET --env prod --body apensum-backups
gh variable set BACKUP_PATH --env prod --body apensum-backups      # optional, the default
gh secret set BACKUP_S3_ACCESS_KEY --env prod --body apensum-backup
gh secret set BACKUP_S3_SECRET_KEY --env prod                      # asks for the user's secret key
```

`BACKUP_S3_REGION` is optional (default `us-east-1`, MinIO's).\
Then run the workflow by hand (`backup`, then `verify`).\
The first run installs `age` on the server (`sudo apt-get install age`, else it says to run it once).\
Without the age private key the backups can't be read: it is in the secret and in the password manager only.

## Two-step login

Everyone who signs in with a password can add a second step in Settings: a code from an authenticator app (scan the QR code, confirm one code), with ten one-time recovery codes for a lost phone.\
An organization's admin decides under Organization settings → Security who must use it: nobody, admins and HR (Admin settings, HR's employment data or the data export), or everyone; the Admin organization always requires it.\
An account spans organizations, so the rule applies at login: whoever an organization requires it of sets it up before getting in (sessions already running last until they end, at most 12 hours), and nobody can turn it off while it is required.\
No organization can turn off or reset someone's second step; for a lost phone without recovery codes the operator runs `twofactor reset <e-mail>` on the server (check who is asking first).\
SSO logins keep their identity provider's own second step.\
The authenticator secrets are encrypted with a key derived from `API_JWT_SECRET`: changing that secret leaves everyone with their recovery codes only.

```sh
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js twofactor status <e-mail>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js twofactor reset <e-mail>
```

## Operator

An organization's owners decide who is owner, admin and HR; an organization without an owner gets one from the instance's operator, who also gives the licenses of paid modules, on the server (no GitHub workflow: this repository's run logs are public).

```sh
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js owner list <slug or id>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js owner set <slug or id> <e-mail>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license list <slug or id>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license grant <slug or id> <module> [--until YYYY-MM-DD]
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license revoke <slug or id> <module>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators list
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators grant <e-mail>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators revoke <e-mail>
```

An owner has to be an active member.\
A license runs through the day given; without one the module is off and its data stays, and the organization's admin switches a licensed module on.\
Every change is in the organization's audit log.

The operators (superusers) are the active members of one fixed organization, "Apensum Admin" (`OPERATOR_ORG_ID` in `packages/shared/src/operator.ts`, changelog 098).\
In it they see only the Super Admin pages (`SuperAdmin.tsx`, API `operator/*` in `operator.controller.ts`): Instance (what runs and is configured, counts; no people's data), Licenses (every organization with its members, owners and licenses, granted, changed and removed), AI limits (each organization's monthly limit and this month's spend, the instance budget), Product news (written, published, sent to the newsletter; organizations only read it), Default lists (the static data every organization starts from: operators add values and lists and change translations, a migration's values stay; `operator-static-data.controller.ts`) and Superusers.\
The whole app has a thick red frame while the Admin organization is selected.\
They have no right inside any other organization, and the pages never show people's data.\
Nobody joins the Admin organization through registration, invitations or roles: only `operators grant` above or an operator on the Superusers page makes someone one (an existing account; the last one stays), and each change is in the Admin organization's audit log.\
The first grant creates the organization.\
Each VPS instance, the public demo included, also gets its own operator account on every deploy and reset (`remote.sh` `ensure_operator`, CLI `operators ensure`): `OPERATOR_EMAIL` (GitHub Environment variable, default `admin@admin.local`) with the password of the GitHub Environment secret `OPERATOR_PASSWORD` (at least 8 characters; without it, nothing happens).\
It is created when missing, its password set to the secret each time, and it belongs to the Admin organization alone; the password never appears in a command line or the (public) run logs.
On servers `PUBLIC_API_URL` (the API host, set by the VPS compose file) keeps the links in newsletter mails and calendar feeds on the public API.

## Deploy

The `vps` and `azure` workflows are manual (`workflow_dispatch`) and take all their config from GitHub Environments (Settings > Environments), not from files on a server or laptop.\
`dev` and `local` keep using `.env.dev` / `.env.local`.

### VPS

**One GitHub Environment = one instance.**\
Production is the environment named `prod`; create another (e.g. `preprod`) to get a second instance, on the same server or another one: production (`wt`), `preprod` (`wtpp`) and `test` (`wttest`) can all run on one host.

**Whale simulation** (a company's life, test and preprod only; `test/simulation/README.md` says what it does and how): manually dispatch `test-simulation.yml` from main, e.g. `gh workflow run test-simulation.yml --ref main -f environment=preprod -f confirmation='SIMULATE preprod'` (preprod needs that confirmation), after `build-push` of that commit is done.\
It resets the instance first (`vps.yml` `reset-seed`, the demo seed), then plays the company Whale day by day from 2008 to yesterday through the API's own services inside the API container, and checks the result over HTTP; `admin@whale.com` / `admin` is its owner.

**Secrets**

| Name | Notes |
| --- | --- |
| `VPS_SSH_KEY` | Private key, no passphrase |
| `POSTGRES_PASSWORD` | Hex only, it goes into a URL |
| `KEYCLOAK_ADMIN_PASSWORD` | Only with `SSO_PROVIDER=keycloak` |
| `DEX_CONNECTORS` | Optional, with `SSO_PROVIDER=dex`: Dex's connectors, a YAML list (see Single sign-on) |
| `API_JWT_SECRET` | |
| `SMTP_PASSWORD` | Optional |
| `NTFY_TOPIC_URL` | Optional, prod: the operator's phone gets a short hint through ntfy (`https://ntfy.sh/<long random topic>`, or the topic alone for one on ntfy.sh; the ntfy app subscribed to it; `apps/api/src/operator-push.ts`) on a message through the website's contact form, a registration and a finding of the API's monitor. A secret: whoever knows a public topic reads and writes it. The push carries no personal data, only what happened (the public server is not in Switzerland). |
| `GHCR_TOKEN` | Optional, `read:packages`, only for private images |

**Variables**

| Name | Notes |
| --- | --- |
| `VPS_HOST`, `VPS_USER` | Server and deploy user |
| `PG_PORT` | This instance's Postgres loopback port; unique per server, e.g. 5434/5435/5436 |
| `DOMAIN` | e.g. `apensum.ch` |
| `WEB_SUB`, `API_SUB`, `AUTH_SUB` | e.g. `apppp`, `apipp`, `authpp` |
| `SSO_PROVIDER` | Optional, `none` (default), `dex` or `keycloak` (see Single sign-on) |
| `KEYCLOAK_ADMIN` | Only with `SSO_PROVIDER=keycloak` |
| `SHOW_DEMO_ACCOUNTS` | Optional, `true`/`false` |
| `TWO_FACTOR` | Optional, `off` turns two-step login off on the instance (set on demo and test; never on prod or preprod) |
| `RESET_BACKUP` | Optional, `false` skips the backup before `reset-seed` (set on demo, preprod, test; only prod is backed up) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_PATH`, `BACKUP_AGE_RECIPIENT` | Optional, the nightly backup (see Backups); secrets `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_AGE_KEY` |
| `DEMO_RESET_EVERY_HOURS` | Optional, demo only (`2`): each deploy puts an entry into the deploy user's crontab that resets the instance every that many hours at minute 7 UTC, skipped within an hour of the last reset (`remote.sh` `demo_reset_timer`, log `/opt/apensum-<env>/demo-reset.log`; without the variable the entry is removed), and the app warns before and waits through the reset; `demo-reset.yml` resets by hand |
| `DEMO_AUTO_LOGIN` | Optional, demo and test (`ueli@acme.com`; dev and local use it too: `scripts/with-env.mjs` sets it unless the env file does, empty = off, and the VS Code API launch sets it): a visitor without a session is signed in as that account, and the login page and the user menu list the people of its organization (roles, department) to switch to; only accounts whose password is the demo seed's (`<name>@...` / `<name>`) are listed, and each switch is an ordinary sign-in (`demo-switch.ts`) |
| `WORKFLOW_RECALL_DAYS` | Optional, every instance (empty = `5`, `0`..`365`): how many days a flow someone did a step of (approved, sent back, done) stays under Flows -> Done for them after it moved on to someone else or finished (`workflows.controller.ts` `workflowRecallDays`, from the flow's history) |
| `GHCR_USERNAME` | Optional |
| `SMTP_HOST/PORT/FROM/USER/SECURE` | Optional |
| `MAIL_SUB` | Optional, publishes the instance's Mailpit inbox at `<MAIL_SUB>.<DOMAIN>` |
| `PORTAINER_SUB` | Optional, Portainer hostname `<PORTAINER_SUB>.<DOMAIN>`, default `portainer`. Set it per server when servers share a `DOMAIN`, e.g. `portainerpp`. |

**Workflow actions.**\
Run the `vps` workflow from `main`, naming the environment and an `image_tag` (prefer a `sha-` tag over `latest`):

| Action | What it does |
| --- | --- |
| `deploy` | Ships the deploy files over SSH and runs `infra/vps/remote.sh`. |
| `portainer` | (Re)deploys Portainer, the Docker UI for the whole server, at `portainer.<DOMAIN>`. It is its own stack in `/opt/edge/portainer`, so instance deploys never touch it. Run it once per server, with any environment of that server (it uses that environment's `DOMAIN`). |
| `portainer-remove` | Takes Portainer down and keeps its data volume. |
| `destroy` | **Destructive.** Removes the instance (containers, its Postgres and volume, `/opt/apensum-<env>`, its Caddy site, and its database on a leftover `edge-pg` if there is one). A last dump stays in the deploy user's home. The shared edge stack and other instances stay. Confirmation text: `DESTROY <environment>`. |
| `seed` | Loads the demo data into a deployed instance, adding only what is missing: nothing is dropped, and demo data changed since (passwords, reporting lines) is kept. Use it after a release adds demo rows. It creates demo users with known passwords, so not for production. Confirmation text: `SEED <environment>`. |
| `reset-seed` | **Destructive.** Backs up and recreates the `public` schema, migrates, loads the demo data and checks a demo login. Needs the confirmation text. A new instance has no users until you run it once. |
| `deploy-reset` | **Destructive.** `deploy` and `reset-seed` in one run: the new images are pulled, the schemas dropped (backed up unless `RESET_BACKUP=false`), the new containers started (the migrations run once, on the empty database), then the demo data. Same confirmation text as `reset-seed`. The demo's scheduled reset takes its image from the newest `deploy` or `deploy-reset`. |

**What `remote.sh` does.**\
It derives everything instance-specific from the environment name:

- Containers (`apensum-<env>-api`, ...), Compose project and `/opt/apensum-<env>`.
- Its own Postgres (`apensum-<env>-pg`, role and database `worktime`, volume per Compose project), bound to `127.0.0.1:PG_PORT` on the server.
- Its own Caddy site at the three hostnames.
- Writes `compose/.env` and `/opt/edge/.env`, creates the `edge` network if missing and brings up the edge stack (`infra/caddy/edge`: just the Caddy shared by all instances) before the instance's `pg`, `mailpit`, `migrate`, `api` and its single sign-on (Dex or Keycloak, if any).

Other things to know:

- The server keeps no git checkout and no hand-edited config.
- One web image serves every instance: its API URL is filled in when the container starts; the single sign-on comes from the API.
- Values must not contain a single quote.
- A leftover `edge-pg` (the old shared Postgres) is not used any more: remove it with `docker rm -f edge-pg`.

**Server prerequisites**

Step by step on a fresh Ubuntu server: [docs/SERVER_SETUP.md](SERVER_SETUP.md).

- Docker with the compose plugin.
- `VPS_USER` is in the `docker` group and owns `/opt/edge` and each `/opt/apensum-*` directory.\
  `remote.sh` creates a missing one with passwordless `sudo` (as `ubuntu` has on cloud images); without it, run `sudo install -d -o "$USER" /opt/apensum-<env>` once (and `sudo chown -R "$USER": /opt/edge /opt/apensum-*` after anything root created).
- DNS A records pointing at the server for the three hostnames, `<PORTAINER_SUB>.<DOMAIN>` (default `portainer`) and, if set, each `MAIL_SUB` hostname.
- Create the Portainer admin right after its first start: it locks itself after 5 minutes without one (an existing admin survives the move out of the edge stack, because the data volume is reused).

**Reaching an instance's Postgres.**\
It listens on the server's loopback only, so use an SSH tunnel:

```sh
ssh -N -L 5434:127.0.0.1:<PG_PORT> <VPS_USER>@<VPS_HOST>
```

Then connect a normal client to `localhost:5434` as role `worktime`, database `worktime`, with that environment's `POSTGRES_PASSWORD`.

### Moving an instance to another server

For a planned move, or when the server is lost (example: `prod`).\
Nothing is needed from the old server: the backups are in the S3 storage, the keys and settings in the GitHub Environment (`BACKUP_AGE_KEY`, `DOCUMENTS_KEY`, `API_JWT_SECRET`, ...), the images in the container registry.\
What was entered after the newest backup is lost (see Backups: hourly through the day, nightly at 01:30 UTC).\
Prepared, it takes about an hour; the slowest part is DNS.

**Before it is needed**

- Lower the TTL of the instance's DNS records (`WEB_SUB`, `API_SUB`, ...) to 300 seconds, so a change reaches everyone within minutes instead of an hour.
- Keep a second server ready, set up as below (it may carry another instance, e.g. `test`).
- Practise once: deploy a scratch environment on that server, restore prod's newest backup into it and sign in (it needs the same `DOCUMENTS_KEY` and `BACKUP_*` settings as prod, and its own hostnames).
- Keep the public key of `VPS_SSH_KEY` with the private one: GitHub shows no secret again (else make a new key pair and replace the secret).

**1. Prepare the server** (20–40 minutes, skipped when it is ready): [docs/SERVER_SETUP.md](SERVER_SETUP.md), which covers the prerequisites above and:

- The public key of `VPS_SSH_KEY` in `~/.ssh/authorized_keys` of `VPS_USER`.
- Ports 80 and 443 open (Caddy), SSH reachable from GitHub's runners.
- `sudo apt-get install age` (the restore decrypts on the server).

**2. Point the environment at it**

```sh
gh variable set VPS_HOST --env prod --body <new server>
gh variable set VPS_USER --env prod --body <user>
gh variable set PG_PORT --env prod --body <port>     # only if another instance on that server uses it
```

**3. Deploy** (about 10 minutes) the tag that ran before; the newest `vps` runs name it in their title:

```sh
gh run list --workflow vps.yml --limit 5
gh workflow run vps.yml --ref main -f action=deploy -f environment=prod -f image_tag=sha-<tag>
```

The instance starts with an empty, migrated database.\
Caddy cannot get its certificates until DNS points at the server (step 5); it keeps trying.

**4. Restore the newest backup** (5–15 minutes; `backup` = a stamp for an older one):

```sh
gh workflow run backup.yml --ref main -f action=restore -f environment=prod -f confirmation='RESTORE prod'
```

**5. Switch DNS**: the A records of `WEB_SUB`, `API_SUB` (and `AUTH_SUB`, `MAIL_SUB`, `PORTAINER_SUB` where used) to the new server.\
Within the TTL everyone reaches the new server; Caddy fetches the certificates by itself.

**6. Check**

- `https://<API_SUB>.<DOMAIN>/api/v1/health` answers, with `smtp` `ok`.
- An operator signs in (two-step login) and a person opens a document: that proves the database and `DOCUMENTS_KEY`.
- "Forgot password" sends a mail.
- Run the `portainer` action once if the server should have it.

**Afterwards**

- The scheduled backups and `monitor.yml` follow by themselves (they use `VPS_HOST` and the public URLs).
- If the old server comes back, stop its instance by hand (`docker compose -p apensum-<env> -f /opt/apensum-<env>/compose/docker-compose.vps.yml down`), so it sends no reminders or mails twice; the workflows reach only the new one now.

### Website (apensum.ch)

The marketing website is `apps/site`: static pages in German, French, Italian and English, built by a dependency-free Node script (texts in `apps/site/src/i18n/<lang>.mjs`, templates in `src/pages.mjs`).\
`npm run site:dev` previews it on http://localhost:3010 with rebuilds on save.\
`apps/site/site.config.mjs` holds the demo link (`demoUrl`, every "Demo" button), the contact address and the operator for the legal notice: fill in its street and postcode/place before the first deploy, the deploy's strict build fails without them.\
An optional portrait for the About page goes in `static/assets/` (`about.photo`).

Deploy with the `site` workflow (Actions -> site -> Run workflow): `environment` picks the server (that GitHub Environment's `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`; it must already run a Apensum instance, for the shared edge Caddy), `domain` the hostname, `app_url` the optional "Log in" target, `contact_url` the contact form's API.\
For the main domain (`apensum.ch`) `infra/site/remote.sh` installs it at `/opt/edge/apensum-site` as its own Caddy container (`apensum-site`) and adds `apensum-site.caddy` to the edge, which gets the certificates for the domain and `www.` (both DNS records must point at the server).\
Any other host is a preview that runs next to it as `apensum-site-<first label>`, without `www.` and sent with `X-Robots-Tag: noindex`.\
For preprod: `domain` `wwwpp.apensum.ch`, `app_url` `https://apppp.apensum.ch`, `contact_url` `https://apipp.apensum.ch/api/v1/public/contact`, and the preprod variable `CONTACT_SITE_ORIGINS` `https://wwwpp.apensum.ch` (the API accepts only listed origins; its mail goes to preprod's Mailpit).\
Each deploy is a new release in `www/releases/`, switched atomically via `www/current`; `remove` takes it down.

### Azure environment

The `azure` GitHub Environment uses the same names as `azure.yml` lists (`AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID`, `POSTGRES_PASSWORD`, …).\
AI (assistant, Cases, receipts) is Azure OpenAI in Switzerland only: its key is repo-level, the budget and prices are Environment variables (`infra/azure/ai-provision.sh github`); they reach the API when `azure.yml` provisions the apps (`azure-deploy` only swaps images, so rerun the apps phase after changing them).\
Environment values override repo-level ones, so existing repo secrets keep working until you move them.

### Releases

Push a `v*` tag to cut a release (`git tag v1.2.0 && git push origin v1.2.0`).\
`build-push` then publishes images tagged `v1.2.0`, without moving `latest`; deploy them by passing that as `image_tag`.\
Every image also records its nearest tag (`git describe`, so `v1.2.0-3-g97d21cd` for a later commit on main), commit and commit date, which the app shows under the user menu's **Information** (web and API separately, since they are deployed as separate images).\
Images built before any tag exists show as untagged; host builds as local.

### Azure Container Apps

The apps run as Container Apps in a plain Consumption environment (no custom VNet, which would add an always-on load balancer): `worktime3-auth` (Keycloak), `worktime3-api`, `worktime3-web`, plus the `worktime3-migrate` and `worktime3-seed` jobs.\
Postgres is an Azure Database for PostgreSQL Flexible Server (Burstable B1ms, public endpoint open only to Azure services, TLS required, `citext`/`uuid-ossp` allowlisted via `azure.extensions`).\
`build-push` publishes the extra `migrate`, `seed`, `dbtools` and `web-azure` images; `web-azure` has the API hostname baked in from the repo variable `AZURE_API_URL` (the single sign-on comes from the API).

First deploy, from Git Bash with the Azure CLI logged into the target tenant:

```sh
cp infra/azure/env.example.azure.cfg infra/azure/.env.azure   # fill in
bash infra/azure/provision.sh base     # network, Postgres, storage, environment; prints gh commands
#   set the printed repo variables, then run build-push and wait for it
bash infra/azure/provision.sh apps     # migrations, keycloak, api, web
bash infra/azure/provision.sh seed     # optional demo data, fresh database only
bash infra/azure/provision.sh github   # deploy identity; prints gh secret commands
bash infra/azure/provision.sh secrets  # copies .env.azure to the secrets the azure-* workflows read
```

After that, `azure-deploy` (manual) runs migrations and rolls api/web to an image tag.\
Backups are Flexible Server's built-in daily ones (7 days).

Day-to-day operations are `provision.sh` phases.\
Run them from the Actions tab with the single `azure` workflow: pick an action from the dropdown.\
They run from `main` only, which is the one ref the deploy identity trusts.\
A code rollout is the separate `azure-deploy` workflow.

| Action | What it does |
|---|---|
| `freeze` | Stops the apps and Postgres. Storage is still billed, and Azure restarts a stopped server after 7 days, so re-run it before then. |
| `unfreeze` | Starts Postgres and the apps. |
| `deepfreeze` | Stops the apps, dumps the database to the `db-dumps` blob container, then deletes the Postgres server. The server is kept if the dump fails. |
| `deepunfreeze` | Recreates the server, restores the newest dump, starts the apps. |
| `dropdb` | Stops the apps and deletes the server with no dump. All data is lost; you must type the server name in `confirm`. |
| `initdb` | Creates an empty server, runs migrations, starts the apps. Refuses if a server exists. The `seed` checkbox also loads the demo data. |
| `seed` | Loads the demo data, fresh database only. |
| `apps` | Re-applies the app specs after a config or secret change. |

`base` and `github` have no workflow: they need more rights than the deploy identity has.\
`azure-deploy` needs a running database, so unfreeze first.

To reach the database from a laptop (psql, DBeaver, ...), open the firewall for your IP while you need it, and close it again afterwards:

```sh
az postgres flexible-server firewall-rule create -g <rg> -n <server> -r laptop \
  --start-ip-address <your ip> --end-ip-address <your ip>
az postgres flexible-server firewall-rule delete -g <rg> -n <server> -r laptop --yes
```

Connect to `<server>.postgres.database.azure.com` as `worktime` with `POSTGRES_PASSWORD` and `sslmode=require`.

## Cases interviews (local MVP)

Enable **Cases** for the organization and use an account with case access.\
An interview can be saved without audio or a transcript.\
Attach or record up to 25 MB of WAV, MP3, M4A, WebM or Ogg audio, the most Azure OpenAI Whisper takes in one request (recording needs microphone permission and HTTPS or localhost; the recorder offers speech quality, 32 kbit/s for about 90 minutes, or high quality, 128 kbit/s for about 25 minutes).\
Only users who can see that case can play its audio; only editors can replace it.\
Audio uses the local DocumentsService store; set `DOCUMENTS_KEY` for encryption at rest.\
Transcript and summary are stored in Postgres, not in the encrypted file store.\
Back up the database and local audio store together.\
With `local` Compose, audio persists in the `api-documents` volume; `docker compose down -v` removes it.

A case document's text (used by the assessment drafts) is read on upload when the text field is left empty: plain text as is, a PDF's text layer with `unpdf` (pdf.js, `case-document-text.ts`).\
A scanned PDF has no text layer and gives nothing (there is no OCR); the page then asks for the text by hand.

Transcription is Azure OpenAI Whisper (Switzerland North, `azure-transcribe.ts`) and **on by default** wherever the instance has Azure configured (`AZURE_OPENAI_*`, `AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT`, `AI_MONTHLY_BUDGET_CHF` and the prices; `infra/azure/ai-provision.sh local` fills `.env.dev`).\
Every call goes through the AI budget: the instance's monthly cap and the organization's limit.\
Whoever edits Organization settings can switch it off (Organization settings -> AI and costs); without Azure on the instance the interview page says transcription is not set up.\
There is no self-hosted transcription.

Transcription runs only when an editor requests a draft.\
Confirm or edit the draft before saving.\
The independent summary action extracts passages from a saved, current transcript; it does not invent conclusions or use an LLM.\
Review drafts for accuracy and context.\
Replacing audio preserves existing text but flags it for review; changing the transcript flags its saved summary.\
Stale text is not reused in new assessment drafts.\
Existing assessments are not rewritten.\
Email links to interviews are not part of this MVP.
