#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server (Contabo or Hetzner). Run as root ON THE SERVER:
#   ssh root@<ip> 'bash -s' < infra/single/bootstrap.sh
# Make sure your SSH key works first: password logins are switched off at the end.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y docker.io docker-compose-v2 rsync unattended-upgrades ufw fail2ban
systemctl enable --now docker

# Swap: building the Next.js apps needs more memory than small servers have.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Firewall on the host (Contabo has no cloud firewall in front): SSH and the web only. All app
# containers bind to 127.0.0.1 (compose.yml), so PostgreSQL, Valkey and the API stay unreachable.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Brute-force protection for SSH (default jail: 5 failures, 10 minutes ban).
systemctl enable --now fail2ban

# SSH: keys only.
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
# Cloud images may switch passwords back on in a drop-in file.
for f in /etc/ssh/sshd_config.d/*.conf; do
  [[ -e $f ]] && sed -i 's/^PasswordAuthentication .*/PasswordAuthentication no/' "$f"
done
systemctl reload ssh

mkdir -p /opt/parkshield/src
echo "Bootstrap done. Docker: $(docker --version); Compose: $(docker compose version --short)"
ufw status verbose | head -12
