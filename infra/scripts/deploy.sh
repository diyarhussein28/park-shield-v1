#!/usr/bin/env bash
# Build images, push them, and roll out with Ansible over WireGuard.
# Usage: infra/scripts/deploy.sh <staging|production> <release-tag-or-sha>
set -euo pipefail

env_name="${1:?environment}"
release="${2:?release}"
registry="${REGISTRY:-ghcr.io/parkshield}"
root="$(cd "$(dirname "$0")/../.." && pwd)"

for target in api web ops; do
  docker buildx build "$root" --target "$target" \
    -t "$registry/parkshield-$target:$release" --push
done

# Secrets arrive via CI environment variables only; nothing readable is written to the repo.
umask 077
tmp="$(mktemp -d)"
trap 'sudo wg-quick down "$tmp/wg0.conf" 2>/dev/null || true; rm -rf "$tmp"' EXIT
printf '%s\n' "$WIREGUARD_CONFIG" > "$tmp/wg0.conf"
printf '%s\n' "$STAGING_SSH_KEY" > "$tmp/id_ed25519"
sudo wg-quick up "$tmp/wg0.conf"

export SOPS_AGE_KEY ANSIBLE_PRIVATE_KEY_FILE="$tmp/id_ed25519"
cd "$root/infra/ansible"
ansible-galaxy collection install -r requirements.yml
ansible-playbook -i "inventories/$env_name/hosts.yml" deploy.yml -e "release=$release"
