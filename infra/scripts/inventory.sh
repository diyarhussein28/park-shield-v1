#!/usr/bin/env bash
# Writes infra/ansible/inventories/<env>/hosts.yml from `terraform output`.
# Usage: infra/scripts/inventory.sh <staging|production>
set -euo pipefail

env_name="${1:?environment}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/infra/ansible/inventories/$env_name/hosts.yml"
ips="$(terraform -chdir="$root/infra/terraform" output -json private_ips)"

jq -r --arg env "$env_name" '
  def host(name; ip; extra): "        ps-\($env)-\(name): { ansible_host: \(ip)\(extra) }";
  [
    "all:",
    "  vars:",
    "    ansible_user: root",
    "    env_name: \($env)",
    "  children:",
    "    app:", "      hosts:",
    (.app | to_entries[] | host("app-\(.key + 1)"; .value; "")),
    "    worker:", "      hosts:",
    host("worker-1"; .worker; ""),
    "    db:", "      hosts:",
    host("db-primary"; .db.primary; ", db_role: primary, db_device: \(.volumes.primary)"),
    host("db-replica"; .db.replica; ", db_role: replica, db_device: \(.volumes.replica)"),
    "    tools:", "      hosts:",
    host("tools-1"; .tools; "")
  ] | join("\n")
' <<<"$ips" > "$out"

echo "wrote $out"
