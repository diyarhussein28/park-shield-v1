#!/usr/bin/env bash
# Copies the working tree to the server, builds the images there, migrates and restarts.
# Run ON YOUR COMPUTER from the repo root:
#   infra/single/deploy.sh root@<server-ip>
# Server-side files (.env, server.env, data/) are never overwritten or deleted.
set -euo pipefail

target="${1:?usage: infra/single/deploy.sh root@<server-ip>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
remote=/opt/parkshield/src

rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .next-prod --exclude .turbo --exclude dist \
  --exclude .git --exclude .local --exclude .env --exclude '.env.*' --include .env.example \
  --exclude e2e/playwright-report --exclude e2e/test-results \
  --exclude /infra/single/.env --exclude /infra/single/server.env --exclude /infra/single/data \
  "$root/" "$target:$remote/"

ssh "$target" bash -s <<'EOF'
set -euo pipefail
cd /opt/parkshield/src/infra/single
docker compose build
if [[ ! -e .env || ! -e server.env ]]; then
  echo
  echo "Images built. First run: create the secrets on the server, then deploy again:"
  echo "  ssh <server> 'cd /opt/parkshield/src/infra/single && bash setup-env.sh <domain> <user>'"
  exit 0
fi
docker compose up -d postgres valkey
docker compose run --rm migrate
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
docker compose ps
EOF
