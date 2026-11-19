# Liquibase's official image ships without a JDBC driver (licensing/size) —
# this adds the Postgres one so `docker compose` can run migrations with no
# extra host setup. Pin both versions explicitly; bump deliberately.
FROM liquibase/liquibase:5.0.4

# -f: an HTTP error fails the build instead of saving an error page as the jar (which Liquibase
# then reports as "Cannot find database driver" on every run, since the broken layer stays cached).
# The checksum pins exactly this file.
RUN curl -fsSL --retry 3 -o /liquibase/lib/postgresql.jar \
      https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar \
 && echo "188976721ead8e8627eb6d8389d500dccc0c9bebd885268a3047180274a6031e  /liquibase/lib/postgresql.jar" | sha256sum -c -

# Bake the changelogs in so the image also works where nothing can be mounted from the repo
# (Azure Container Apps job). Compose and migrate.mjs still mount ./changelog over this copy.
COPY changelog /liquibase/changelog

# Plugin changelogs (plugins/<id>/changelog), copied here by `node scripts/plugins.mjs stage-changelogs`
# before an image build that has to carry them (Azure, VPS); compose and migrate.mjs mount the
# repository's plugins/ over it. apensum-migrate.sh runs the core's changelog, then each plugin's.
COPY plugins /liquibase/plugins
COPY --chmod=755 apensum-migrate.sh /liquibase/apensum-migrate.sh
ENTRYPOINT ["/liquibase/apensum-migrate.sh"]
