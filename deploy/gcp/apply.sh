#!/usr/bin/env bash
# Plans and applies the Spur stack. Refuses a plan that deletes or replaces
# anything, and applies only after the project ID is typed back.
# Extra arguments go to terraform plan, e.g. ./apply.sh -target=google_secret_manager_secret.runtime
set -euo pipefail
umask 077
cd "$(dirname "$0")"

project=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' terraform.tfvars)
if [ -z "$project" ]; then
  echo "terraform.tfvars has no project_id." >&2
  exit 1
fi

# The README's gcloud commands use the active project, so it must match.
active=$(gcloud config get-value project 2>/dev/null || true)
if [ "$active" != "$project" ]; then
  echo "gcloud is set to '$active', not '$project'." >&2
  echo "Run: gcloud config set project $project" >&2
  exit 1
fi

plan=spur.tfplan
trap 'rm -f "$plan"' EXIT
terraform plan -input=false -out="$plan" "$@"

# Piped, not saved: the JSON plan holds the database password in plain text.
destructive=$(terraform show -json "$plan" |
  jq -r '.resource_changes[]? | select(.change.actions | index("delete")) | .address')
if [ -n "$destructive" ]; then
  echo
  echo "Refused. This plan would delete or replace:" >&2
  echo "$destructive" >&2
  echo "Nothing was changed. Send the plan output to whoever maintains Spur." >&2
  exit 1
fi

echo
read -r -p "Nothing will be deleted. Type the project ID ($project) to apply: " answer
if [ "$answer" != "$project" ]; then
  echo "Not applied."
  exit 1
fi
terraform apply -input=false "$plan"
