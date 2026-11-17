# Run by start.sh in `superset shell`: the role embedded viewers (guest tokens) get. Gamma's
# read permissions plus access to all datasets; which dashboard and which rows a guest sees is
# decided per token by the Apensum API (resources + row-level security).
from superset import security_manager as sm
from superset.extensions import db

gamma = sm.find_role("Gamma")
role = sm.find_role("Embedded") or sm.add_role("Embedded")
everything = sm.find_permission_view_menu("all_datasource_access", "all_datasource_access")
role.permissions = list(gamma.permissions) + ([everything] if everything else [])
db.session.commit()
print("Embedded role:", len(role.permissions), "permissions")
