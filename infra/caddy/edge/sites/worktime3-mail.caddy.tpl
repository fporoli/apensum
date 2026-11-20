# Optional block for one instance's Mailpit web UI (its inbox), appended to the instance's
# site file by infra/vps/remote.sh when the MAIL_SUB variable is set. Caddy gates it with
# Basic Auth: user `admin`, bcrypt hash generated from MAILPIT_ADMIN_PASSWORD (default: admin).
__MAIL_HOST__ {
  basic_auth {
    admin __MAIL_HASH__
  }
  reverse_proxy __PREFIX__-mailpit:8025
}
