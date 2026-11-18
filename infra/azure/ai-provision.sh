#!/usr/bin/env bash
# Azure resources for the Cases module's optional paid AI (transcription + summaries + assessment drafts),
# shared by every environment (dev, local, test, preprod, demo, prod, azure). Kept apart from the app's
# own resources (provision.sh) in their own resource group, so their cost is visible on its own and the
# group's budget alert covers exactly them.
#
#   infra/azure/ai-provision.sh resources   resource group, Azure OpenAI + chat and Whisper deployments, budget alert
#   infra/azure/ai-provision.sh github      keys/endpoint/prices as repository secrets/variables, budgets per environment
#   infra/azure/ai-provision.sh local       the same into .env.dev and .env.local (gitignored)
#   infra/azure/ai-provision.sh all         the three above
#   infra/azure/ai-provision.sh rotate      new key (the manual kill switch), then github + local
#
# Everything runs in Switzerland North with "Standard" (regional) deployments, so the data is
# processed in Switzerland; "Global" deployments are refused. Transcription is Azure OpenAI Whisper:
# Azure Speech has no fast (synchronous) transcription in Switzerland North. Pay-as-you-go: nothing costs while idle.
# The hard spending limits are in the API (ai-budget.service.ts): AI_MONTHLY_BUDGET_CHF per environment
# and each organization's monthly limit. The Azure budget here only e-mails; it never stops anything.
# Re-runnable: existing resources are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUBSCRIPTION="${AI_SUBSCRIPTION:-$(az account show --query id -o tsv)}"
RG="${AI_RESOURCE_GROUP:-apensum-ai}"
LOCATION="${AI_LOCATION:-switzerlandnorth}"
OPENAI="${AI_OPENAI_NAME:-apensum-openai-ch}"         # also its custom subdomain: globally unique
DEPLOYMENT="${AI_DEPLOYMENT:-gpt-4.1-mini}"
MODEL="${AI_MODEL:-gpt-4.1-mini}"
MODEL_VERSION="${AI_MODEL_VERSION:-2025-04-14}"
TRANSCRIBE_DEPLOYMENT="${AI_TRANSCRIBE_DEPLOYMENT:-whisper}"
TPM_THOUSANDS="${AI_TPM_THOUSANDS:-20}"               # tokens-per-minute quota in thousands: caps how fast money can go
AZURE_BUDGET="${AI_AZURE_BUDGET:-50}"                 # monthly alert amount for the group, billing currency
ALERT_EMAIL="${AI_ALERT_EMAIL:-$(az account show --query user.name -o tsv)}"
# Prices in CHF, rounded up from the Azure price sheet; the API estimates and accounts with them.
TRANSCRIBE_CHF_PER_HOUR="${AZURE_TRANSCRIBE_CHF_PER_HOUR:-1.00}"
OPENAI_CHF_PER_1M_INPUT="${AZURE_OPENAI_CHF_PER_1M_INPUT:-0.50}"
OPENAI_CHF_PER_1M_OUTPUT="${AZURE_OPENAI_CHF_PER_1M_OUTPUT:-2.00}"
# AI_MONTHLY_BUDGET_CHF per environment: GitHub Environment name or dev/local -> CHF.
BUDGETS="${AI_BUDGETS:-dev=5 local=5 test=5 preprod=5 demo=10 prod=10 azure=5}"

az account set --subscription "$SUBSCRIPTION"

resources() {
  # A subscription that never used AI services has to register the provider once (free).
  local ns
  for ns in Microsoft.CognitiveServices Microsoft.Consumption; do
    [ "$(az provider show -n "$ns" --query registrationState -o tsv 2>/dev/null)" = Registered ] || az provider register -n "$ns" --wait -o none
  done
  az group create -n "$RG" -l "$LOCATION" --tags app=apensum purpose=cases-ai -o none
  echo "  resource group $RG ($LOCATION)"

  if ! az cognitiveservices account show -g "$RG" -n "$OPENAI" -o none 2>/dev/null; then
    az cognitiveservices account create -g "$RG" -n "$OPENAI" -l "$LOCATION" --kind OpenAI --sku S0 --custom-domain "$OPENAI" --yes -o none
  fi
  echo "  Azure OpenAI $OPENAI (S0)"

  if ! az cognitiveservices account deployment show -g "$RG" -n "$OPENAI" --deployment-name "$DEPLOYMENT" -o none 2>/dev/null; then
    az cognitiveservices account deployment create -g "$RG" -n "$OPENAI" --deployment-name "$DEPLOYMENT" \
      --model-name "$MODEL" --model-version "$MODEL_VERSION" --model-format OpenAI \
      --sku-name Standard --sku-capacity "$TPM_THOUSANDS" -o none
  fi
  local sku
  sku="$(az cognitiveservices account deployment show -g "$RG" -n "$OPENAI" --deployment-name "$DEPLOYMENT" --query sku.name -o tsv)"
  [ "$sku" = Standard ] || { echo "Deployment $DEPLOYMENT is $sku, not Standard (regional): data would leave Switzerland" >&2; exit 1; }
  echo "  deployment $DEPLOYMENT ($MODEL $MODEL_VERSION, Standard, ${TPM_THOUSANDS}k TPM)"

  # Whisper: capacity 1 = the smallest quota (a few requests per minute), plenty for interviews.
  if ! az cognitiveservices account deployment show -g "$RG" -n "$OPENAI" --deployment-name "$TRANSCRIBE_DEPLOYMENT" -o none 2>/dev/null; then
    az cognitiveservices account deployment create -g "$RG" -n "$OPENAI" --deployment-name "$TRANSCRIBE_DEPLOYMENT" \
      --model-name whisper --model-version 001 --model-format OpenAI --sku-name Standard --sku-capacity 1 -o none
  fi
  sku="$(az cognitiveservices account deployment show -g "$RG" -n "$OPENAI" --deployment-name "$TRANSCRIBE_DEPLOYMENT" --query sku.name -o tsv)"
  [ "$sku" = Standard ] || { echo "Deployment $TRANSCRIBE_DEPLOYMENT is $sku, not Standard (regional)" >&2; exit 1; }
  echo "  deployment $TRANSCRIBE_DEPLOYMENT (whisper 001, Standard)"

  local start body
  start="$(date -u +%Y-%m-01T00:00:00Z)"
  body="$(cat <<EOF
{"properties": {"category": "Cost", "amount": $AZURE_BUDGET, "timeGrain": "Monthly",
  "timePeriod": {"startDate": "$start", "endDate": "2035-12-31T00:00:00Z"},
  "notifications": {
    "actual50":  {"enabled": true, "operator": "GreaterThanOrEqualTo", "threshold": 50,  "thresholdType": "Actual", "contactEmails": ["$ALERT_EMAIL"]},
    "actual80":  {"enabled": true, "operator": "GreaterThanOrEqualTo", "threshold": 80,  "thresholdType": "Actual", "contactEmails": ["$ALERT_EMAIL"]},
    "actual100": {"enabled": true, "operator": "GreaterThanOrEqualTo", "threshold": 100, "thresholdType": "Actual", "contactEmails": ["$ALERT_EMAIL"]}
  }}}
EOF
)"
  az rest --method put -o none \
    --url "https://management.azure.com/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.Consumption/budgets/apensum-ai?api-version=2023-05-01" \
    --body "$body"
  echo "  budget alert $AZURE_BUDGET/month on $RG -> $ALERT_EMAIL (50/80/100 %)"
}

openai_key() { az cognitiveservices account keys list -g "$RG" -n "$OPENAI" --query key1 -o tsv; }
openai_endpoint() { az cognitiveservices account show -g "$RG" -n "$OPENAI" --query properties.endpoint -o tsv | sed 's:/*$::'; }

budget_for() {
  local env="$1" pair
  for pair in $BUDGETS; do [ "${pair%%=*}" = "$env" ] && { echo "${pair#*=}"; return; }; done
  echo 5
}

github() {
  local repo
  repo="$(cd "$ROOT" && gh repo view --json nameWithOwner -q .nameWithOwner)"
  openai_key | gh secret set AZURE_OPENAI_KEY --repo "$repo"
  gh variable set AZURE_OPENAI_ENDPOINT --repo "$repo" --body "$(openai_endpoint)"
  gh variable set AZURE_OPENAI_DEPLOYMENT --repo "$repo" --body "$DEPLOYMENT"
  gh variable set AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT --repo "$repo" --body "$TRANSCRIBE_DEPLOYMENT"
  gh variable set AZURE_TRANSCRIBE_CHF_PER_HOUR --repo "$repo" --body "$TRANSCRIBE_CHF_PER_HOUR"
  gh variable set AZURE_OPENAI_CHF_PER_1M_INPUT --repo "$repo" --body "$OPENAI_CHF_PER_1M_INPUT"
  gh variable set AZURE_OPENAI_CHF_PER_1M_OUTPUT --repo "$repo" --body "$OPENAI_CHF_PER_1M_OUTPUT"
  echo "  repository $repo: AZURE_OPENAI_KEY (secret); endpoint, deployments, prices (variables)"
  local env
  for env in $(gh api "repos/$repo/environments" --jq '.environments[].name'); do
    gh variable set AI_MONTHLY_BUDGET_CHF --repo "$repo" --env "$env" --body "$(budget_for "$env")"
    echo "  environment $env: AI_MONTHLY_BUDGET_CHF=$(budget_for "$env")"
  done
  echo "  Takes effect with each environment's next deploy."
}

# Sets KEY=value in an env file: replaces an existing (or commented-out) line, else appends.
set_env() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ "^#? *" k "=" { if (!done) { print k "=" v; done = 1 }; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

local_env() {
  local env file openai endpoint
  openai="$(openai_key)"; endpoint="$(openai_endpoint)"
  for env in dev local; do
    file="$ROOT/.env.$env"
    [ -f "$file" ] || { echo "  $file missing, skipped"; continue; }
    set_env "$file" AZURE_OPENAI_ENDPOINT "$endpoint"
    set_env "$file" AZURE_OPENAI_KEY "$openai"
    set_env "$file" AZURE_OPENAI_DEPLOYMENT "$DEPLOYMENT"
    set_env "$file" AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT "$TRANSCRIBE_DEPLOYMENT"
    set_env "$file" AI_MONTHLY_BUDGET_CHF "$(budget_for "$env")"
    set_env "$file" AZURE_TRANSCRIBE_CHF_PER_HOUR "$TRANSCRIBE_CHF_PER_HOUR"
    set_env "$file" AZURE_OPENAI_CHF_PER_1M_INPUT "$OPENAI_CHF_PER_1M_INPUT"
    set_env "$file" AZURE_OPENAI_CHF_PER_1M_OUTPUT "$OPENAI_CHF_PER_1M_OUTPUT"
    echo "  $file: Azure keys and AI_MONTHLY_BUDGET_CHF=$(budget_for "$env") (restart the API)"
  done
}

rotate() {
  az cognitiveservices account keys regenerate -g "$RG" -n "$OPENAI" --key-name key1 -o none
  echo "  key1 of $OPENAI regenerated: every running API now gets ai-provider-unavailable"
}

case "${1:-}" in
  resources) resources ;;
  github) github ;;
  local) local_env ;;
  all) resources; github; local_env ;;
  rotate) rotate; github; local_env ;;
  *) echo "usage: $0 resources|github|local|all|rotate" >&2; exit 2 ;;
esac
