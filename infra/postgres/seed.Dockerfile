# One-shot demo-data seeder for environments that can't mount the repo (Azure Container Apps
# job). Connection comes from the standard PG* env vars; same psql flags as run-seed.mjs: seed.sql,
# then each plugin's seed (seeds/plugins/<id>.sql, staged by `node scripts/plugins.mjs stage-seeds`),
# in one transaction.
FROM postgres:16-alpine
COPY seeds/seed.sql /seed/seed.sql
COPY seeds/plugins /seed/plugins
ENTRYPOINT ["sh", "-c", "set -- -f /seed/seed.sql; for f in /seed/plugins/*.sql; do [ -f \"$f\" ] && set -- \"$@\" -f \"$f\"; done; exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction \"$@\""]
