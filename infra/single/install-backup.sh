#!/usr/bin/env bash
# One-time: creates the backup encryption key and the nightly cron job. Run ON THE SERVER as root:
#   bash /opt/parkshield/src/infra/single/install-backup.sh
# Afterwards copy the key to a safe place OFF the server (password manager):
#   ssh root@<server> cat /root/parkshield-backup.key
set -euo pipefail

KEY=/root/parkshield-backup.key
if [[ ! -s $KEY ]]; then
  umask 077
  openssl rand -base64 48 >"$KEY"
  echo "Created $KEY - store a copy outside the server, or the backups cannot be decrypted."
fi
chmod 600 "$KEY"

cat >/etc/cron.d/parkshield-backup <<'EOF'
# Nightly encrypted PostgreSQL backup to Object Storage, with a restore check (infra/single/backup.sh).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * * root /opt/parkshield/src/infra/single/backup.sh >>/var/log/parkshield-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/parkshield-backup

cat >/etc/logrotate.d/parkshield-backup <<'EOF'
/var/log/parkshield-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF
echo "Cron installed: daily 03:15 server time, log /var/log/parkshield-backup.log"
