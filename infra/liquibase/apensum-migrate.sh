#!/bin/bash
# The migrate image's entrypoint: `update` runs the core's changelog and every plugin's in one Liquibase run
# (below); other commands run with the given arguments for the core's changelog
# (/liquibase/changelog), then once per plugin changelog (/liquibase/plugins/<id>/changelog/
# db.changelog-master.xml) with the same arguments, the changelog file swapped. All of them share
# DATABASECHANGELOG; a plugin's changesets are recorded as "<id>/changelog/<file>", so they never
# collide with the core's. docs/PLUGINS.md.
#
# APENSUM_CHANGELOG=core runs only the core's changelog, APENSUM_CHANGELOG=<id> only that plugin's
# (migrate.mjs status checks each one on its own). Anything that is not a Liquibase option
# (e.g. `bash`) goes to the stock entrypoint unchanged.
set -euo pipefail

if [[ $# -eq 0 || "$1" != --* ]]; then
  exec /liquibase/docker-entrypoint.sh "$@"
fi

only="${APENSUM_CHANGELOG:-}"

# The plugins' changelog masters in their order: APENSUM_PLUGIN_ORDER (migrate.mjs, from the manifests' `requires`),
# else the ORDER file `plugins.mjs stage-changelogs` writes into the image, else by folder name.
plugin_masters() {
  local ids=()
  if [[ -n "${APENSUM_PLUGIN_ORDER:-}" ]]; then
    read -r -a ids <<< "$APENSUM_PLUGIN_ORDER"
  elif [[ -f /liquibase/plugins/ORDER ]]; then
    while IFS= read -r id; do [[ -n "$id" ]] && ids+=("$id"); done < /liquibase/plugins/ORDER
  else
    for m in /liquibase/plugins/*/changelog/db.changelog-master.xml; do
      [[ -f "$m" ]] || continue
      m="${m#/liquibase/plugins/}"
      ids+=("${m%%/*}")
    done
  fi
  local id
  for id in "${ids[@]}"; do
    [[ -f "/liquibase/plugins/$id/changelog/db.changelog-master.xml" ]] && echo "/liquibase/plugins/$id/changelog/db.changelog-master.xml"
  done
  return 0
}

# `update` of everything runs Liquibase once (one JVM start instead of one per changelog): a master in /tmp
# includes the core's master and each plugin's through two search paths, so every changeset is recorded under
# the same name as when they run one by one (the core's "NNN-name.sql", a plugin's "<id>/changelog/<file>").
if [[ -z "$only" && " $* " == *" update "* ]]; then
  all=/tmp/apensum-all
  mkdir -p "$all"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">'
    echo '  <include file="db.changelog-master.xml"/>'
    while IFS= read -r master; do
      echo "  <include file=\"${master#/liquibase/plugins/}\"/>"
      echo "Plugin changelog: ${master#/liquibase/plugins/}" >&2
    done < <(plugin_masters)
    echo '</databaseChangeLog>'
  } > "$all/apensum-all.xml"
  args=()
  for a in "$@"; do
    case "$a" in
      --changelog-file=*|--search-path=*) ;;
      *) args+=("$a") ;;
    esac
  done
  cd /liquibase/changelog
  exec /liquibase/docker-entrypoint.sh --search-path="$all,/liquibase/changelog,/liquibase/plugins" --changelog-file=apensum-all.xml "${args[@]}"
fi

if [[ -z "$only" || "$only" == core ]]; then
  /liquibase/docker-entrypoint.sh "$@"
fi
[[ "$only" == core ]] && exit 0

args=()
for a in "$@"; do
  case "$a" in
    --changelog-file=*|--search-path=*) ;;
    *) args+=("$a") ;;
  esac
done

found=false
while IFS= read -r master; do
  rel="${master#/liquibase/plugins/}"
  id="${rel%%/*}"
  [[ -z "$only" || "$only" == "$id" ]] || continue
  found=true
  echo "Plugin changelog: $rel"
  (cd /liquibase/plugins && /liquibase/liquibase --defaultsFile=/liquibase/liquibase.docker.properties \
    --search-path=/liquibase/plugins --changelog-file="$rel" "${args[@]}")
done < <(plugin_masters)

if [[ -n "$only" && "$found" == false ]]; then
  echo "No changelog for plugin \"$only\" under /liquibase/plugins" >&2
  exit 2
fi
