# Superset settings for Apensum (read from PYTHONPATH by Superset at start).
#
# Apensum embeds Superset dashboards: the Apensum API asks Superset for a short-lived guest token
# per viewer, limited to one dashboard and, by row-level security, to the viewer's organization and
# the people they may see. Guests get the `Embedded` role (embedded_role.py): read dashboards and
# charts, nothing else. Superset reads Apensum's data only through the `reporting` views, as the
# read-only database user `superset_reader` (infra/superset/reporting.sql).
import os

SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]
# Superset's own settings (users, charts, dashboards) in a SQLite file in its volume.
SQLALCHEMY_DATABASE_URI = "sqlite:////app/superset_home/superset.db"

FEATURE_FLAGS = {"EMBEDDED_SUPERSET": True}
GUEST_ROLE_NAME = "Embedded"
GUEST_TOKEN_JWT_SECRET = os.environ["SUPERSET_GUEST_TOKEN_SECRET"]
GUEST_TOKEN_JWT_EXP_SECONDS = 300

# The Apensum API calls the guest-token endpoint server to server with a bearer token, no session.
WTF_CSRF_EXEMPT_LIST = [
    "superset.views.core.log",
    "superset.views.core.explore_json",
    "superset.charts.data.api.data",
    "superset.dashboards.api.cache_dashboard_screenshot",
    "superset.security.api.guest_token",
]

# Dev: the dashboard is framed by the web app on another port. A real deployment sets
# Talisman's frame-ancestors to the app's origin instead of switching it off.
TALISMAN_ENABLED = False

BABEL_DEFAULT_LOCALE = "de"
LANGUAGES = {
    "de": {"flag": "de", "name": "Deutsch"},
    "fr": {"flag": "fr", "name": "Français"},
    "it": {"flag": "it", "name": "Italiano"},
    "en": {"flag": "us", "name": "English"},
}
