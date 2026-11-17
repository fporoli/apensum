# Superset for Apensum's embedded dashboards (trial, dev only for now: compose/docker-compose.dev.yml,
# profile `bi`). The official image ships without database drivers: add the PostgreSQL one.
FROM apache/superset:6.1.0
USER root
RUN uv pip install --python /app/.venv/bin/python --no-cache psycopg2-binary==2.9.10
COPY superset_config.py /app/pythonpath/superset_config.py
COPY embedded_role.py start.sh /app/apensum/
RUN chmod +x /app/apensum/start.sh
USER superset
CMD ["/app/apensum/start.sh"]
