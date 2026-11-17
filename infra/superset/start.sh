#!/bin/sh
# Prepares Superset's own database on every start (idempotent), then runs the server.
set -e
superset db upgrade
superset fab create-admin --username admin --firstname Admin --lastname Apensum \
  --email admin@localhost --password "${SUPERSET_ADMIN_PASSWORD:?}" || true
superset init
superset shell < /app/apensum/embedded_role.py
exec /app/docker/entrypoints/run-server.sh
