# Setting up a fresh server

How to prepare a new Linux server (Ubuntu 24.04 LTS) for Apensum instances, before the first `vps` deploy.\
The README's "Deploy → VPS" covers the GitHub side (Environment, secrets, variables) and "Moving an instance to another server" what follows on a server that replaces another.\
It takes 20–40 minutes.

The deploy user is called `ubuntu` here; use the same name as `VPS_USER`.\
Commands with `sudo` run as `ubuntu`; the first steps run as `root`.

## 1. Update the system (as root)

Sign in as `root` (the provider's console or SSH with the provider's initial password).

```sh
apt update && apt upgrade -y
passwd                     # a strong root password, kept in the password manager (for the provider's console)
reboot
```

## 2. The deploy user (as root)

```sh
adduser ubuntu                                         # asks for a password; keep it in the password manager
usermod -aG sudo ubuntu
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu
chmod 440 /etc/sudoers.d/ubuntu
visudo -c                                              # checks the sudoers files; must say "parsed OK"
```

Passwordless `sudo` lets `remote.sh` create a missing `/opt/apensum-<env>` and the backups install `age`.\
Without it, create those yourself (step 6) and install `age` by hand (step 5).

## 3. SSH key (as ubuntu)

The `vps` and `backup` workflows sign in with the private key in the secret `VPS_SSH_KEY` (no passphrase).\
Put its public key on the server:

```sh
su - ubuntu
install -d -m 700 ~/.ssh
nano ~/.ssh/authorized_keys        # paste the public key (one line, ssh-ed25519 ...)
chmod 600 ~/.ssh/authorized_keys
```

No key pair yet?\
Make one on your own computer with `ssh-keygen -t ed25519 -N '' -f apensum-vps`, put `apensum-vps.pub` on the server and the private key `apensum-vps` into the secret (`gh secret set VPS_SSH_KEY --env <env> < apensum-vps`).\
Keep both files in the password manager: GitHub never shows a secret again.

Check from your computer that `ssh -i apensum-vps ubuntu@<server>` works before going on.\
Then, optionally, turn off password and root logins over SSH:

```sh
sudo tee /etc/ssh/sshd_config.d/90-apensum.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
EOF
sudo systemctl reload ssh
```

Keep the SSH session open and test a new login in a second window before closing it.

## 4. Docker (as ubuntu)

Docker's own packages (the compose plugin included), as [Docker's guide](https://docs.docker.com/engine/install/ubuntu/) describes:

```sh
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu     # the package creates the group
```

Sign out and in again (the new group applies to new sessions), then check without `sudo`:

```sh
docker run --rm hello-world
docker compose version
```

## 5. Firewall, updates and tools (as ubuntu)

Only SSH, HTTP and HTTPS are open.\
Allow SSH before enabling the firewall, or the session is cut off.

```sh
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP (Caddy, Let's Encrypt certificates)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable            # asks for confirmation: answer y
sudo ufw status verbose
```

Docker's published ports bypass `ufw`.\
That is why every instance's Postgres listens on `127.0.0.1` only and only Caddy publishes ports (80, 443): never publish another port on all addresses.

Security updates installed by themselves, `age` for the backups, and a few tools:

```sh
sudo apt install -y unattended-upgrades age vim net-tools
sudo dpkg-reconfigure -plow unattended-upgrades       # answer Yes
```

## 6. Directories (as ubuntu)

The shared Caddy (`/opt/edge`) and one directory per instance on this server, owned by the deploy user:

```sh
sudo install -d -o ubuntu -g ubuntu /opt/edge /opt/apensum-prod /opt/apensum-demo /opt/apensum-preprod /opt/apensum-test
```

List only the instances this server will run.

## 7. Then, in GitHub and DNS

1. Each instance's GitHub Environment: `VPS_HOST` (the server's address) and `VPS_USER` (`ubuntu`), and a `PG_PORT` no other instance on this server uses (README, "Deploy → VPS").
2. DNS A records of the instance's hostnames (`WEB_SUB`, `API_SUB`, ...) and `portainer` to the server.
3. The `vps` workflow's `deploy`, then `portainer` once per server; create Portainer's admin within 5 minutes of its start.
4. A new instance: `reset-seed` for demo data, or `restore` of a backup (README, "Moving an instance to another server").
5. Prod: run the `backup` workflow by hand (`backup`, then `verify`) to check that backups reach the storage.
