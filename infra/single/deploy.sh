#!/usr/bin/env bash
# Deploys the latest pushed `main` to the server: builds the images there, migrates and restarts.
# Run ON YOUR COMPUTER from the repo:
#   infra/single/deploy.sh root@<server-ip>
#
# Safe for several people deploying from different laptops:
# - It ships exactly the commit `origin/main` points to (via `git archive`), never your working
#   tree, so uncommitted or unpushed changes cannot reach the server.
# - It refuses a commit that does not contain the one already running (that would silently roll
#   back someone else's work). Undo a bad deploy with `git revert` on main; ALLOW_ROLLBACK=1 only
#   overrides the check after main was rewritten on purpose.
# - Only one deploy runs at a time (lock on the server).
# - Every deploy is logged on the server in /opt/parkshield/deploys.log (who, when, which commit).
# Server-side files (.env, server.env, data/) are never overwritten or deleted.
set -euo pipefail

target="${1:?usage: infra/single/deploy.sh root@<server-ip>}"
cd "$(dirname "$0")/../.."
remote=/opt/parkshield/src
lock=/opt/parkshield/deploy.lock

# 1. What to deploy: the current origin/main, nothing local.
git fetch --quiet origin main
commit="$(git rev-parse origin/main)"
subject="$(git log -1 --format=%s "$commit")"
who="$(git config user.name || whoami)"
if [[ "$(git rev-parse HEAD)" != "$commit" ]]; then
  echo "Note: your checkout (HEAD) is not origin/main. Deploying origin/main ${commit:0:7}, not your local state."
  echo "      Unpushed commits are NOT included; push them first if they should go live."
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Note: you have uncommitted changes. They are NOT deployed."
fi

# 2. Never roll back someone else's deploy by accident.
deployed="$(ssh "$target" "cat $remote/DEPLOYED_COMMIT 2>/dev/null || true")"
if [[ -n "$deployed" && "$deployed" != "$commit" ]]; then
  if ! git cat-file -e "$deployed^{commit}" 2>/dev/null ||
    ! git merge-base --is-ancestor "$deployed" "$commit"; then
    if [[ "${ALLOW_ROLLBACK:-}" != 1 ]]; then
      echo "Refusing: the server runs ${deployed:0:7}, which is not part of origin/main ${commit:0:7}."
      echo "Deploying would remove changes that are live now. Check the log:"
      echo "  ssh $target tail -5 /opt/parkshield/deploys.log"
      echo "Roll back on purpose with ALLOW_ROLLBACK=1."
      exit 1
    fi
    echo "ALLOW_ROLLBACK=1: replacing ${deployed:0:7} with ${commit:0:7}."
  fi
fi

# 3. One deploy at a time.
owner="$(printf '%q' "$who ${commit:0:7}")"
if ! ssh "$target" "mkdir $lock 2>/dev/null && echo \"\$(date -Is)\" $owner > $lock/owner"; then
  echo "Refusing: another deploy is running:"
  ssh "$target" "cat $lock/owner 2>/dev/null || true"
  echo "If you are sure it is stale (crashed deploy), remove it: ssh $target rm -rf $lock"
  exit 1
fi
trap 'ssh "$target" "rm -rf $lock" || true' EXIT

echo "Deploying ${commit:0:7} \"$subject\" as $who"

# 4. Ship exactly that commit.
tree="$(mktemp -d)"
trap 'rm -rf "$tree"; ssh "$target" "rm -rf $lock" || true' EXIT
git archive "$commit" | tar -x -C "$tree"

# DEPLOYED_COMMIT is written on the server only after a successful start (end of the script).
rsync -az --delete --exclude /DEPLOYED_COMMIT \
  --exclude /infra/single/.env --exclude /infra/single/server.env --exclude /infra/single/data \
  "$tree/" "$target:$remote/"

# ssh joins its arguments into one remote command line: quote them so names and subjects survive.
ssh "$target" "bash -s -- $(printf '%q ' "$who" "$commit" "$subject")" <<'EOF'
set -euo pipefail
cd /opt/parkshield/src/infra/single
if [[ -e .env ]]; then
  docker compose build
else
  # First run: compose.yml requires the passwords even to build. They are only used at runtime,
  # so placeholders are fine here; setup-env.sh writes the real ones.
  POSTGRES_PASSWORD=unused VALKEY_PASSWORD=unused docker compose build
fi
if [[ ! -e .env || ! -e server.env ]]; then
  echo
  echo "Images built. First run: create the secrets on the server, then deploy again:"
  echo "  ssh <server> 'cd /opt/parkshield/src/infra/single && bash setup-env.sh <domain> <user>'"
  exit 0
fi
docker compose up -d postgres valkey
# -T and </dev/null: this script arrives on stdin; without them `run` swallows the lines below.
docker compose run --rm -T migrate </dev/null
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
docker compose ps
printf '%s\n' "$2" > /opt/parkshield/src/DEPLOYED_COMMIT
printf '%s\t%s\t%s\t%s\n' "$(date -Is)" "$1" "$2" "$3" >> /opt/parkshield/deploys.log
EOF
echo "Deployed ${commit:0:7}. History: ssh $target tail /opt/parkshield/deploys.log"
