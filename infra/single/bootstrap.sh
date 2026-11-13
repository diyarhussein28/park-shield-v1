#!/usr/bin/env bash
# One-time preparation of a fresh Hetzner Ubuntu 24.04 server. Run as root ON THE SERVER:
#   bash bootstrap.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y docker.io docker-compose-v2 rsync unattended-upgrades
systemctl enable --now docker

# Swap: building the Next.js apps needs more memory than small servers have.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# SSH: keys only.
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh

mkdir -p /opt/parkshield/src
echo "Bootstrap done. Docker: $(docker --version); Compose: $(docker compose version --short)"
