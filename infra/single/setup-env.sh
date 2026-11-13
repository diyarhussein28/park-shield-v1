#!/usr/bin/env bash
# Creates .env (compose + Caddy) and server.env (apps) with freshly generated secrets.
# Run ON THE SERVER in /opt/parkshield/src/infra/single after the first image build:
#   bash setup-env.sh <domain> <basic-auth-user>
# Never overwrites existing files. Provider keys (Twilio, …) are added to server.env by hand.
set -euo pipefail
cd "$(dirname "$0")"

domain="${1:?usage: setup-env.sh <domain> <basic-auth-user>}"
auth_user="${2:?usage: setup-env.sh <domain> <basic-auth-user>}"

if [[ -e .env || -e server.env ]]; then
  echo ".env or server.env already exists; refusing to overwrite." >&2
  exit 1
fi
if ! docker image inspect parkshield-api:local >/dev/null 2>&1; then
  echo "Image parkshield-api:local missing: run 'docker compose build' first." >&2
  exit 1
fi

hex() { openssl rand -hex 24; }
key32() { openssl rand -base64 32; }

read -r -s -p "Basic auth password for ${auth_user}: " auth_pass
echo
[[ ${#auth_pass} -ge 12 ]] || { echo "Use at least 12 characters." >&2; exit 1; }
auth_hash="$(docker run --rm caddy:2 caddy hash-password --plaintext "$auth_pass")"

pg_pass="$(hex)"
valkey_pass="$(hex)"
vapid="$(docker run --rm parkshield-api:local node -e \
  "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")"
vapid_public="${vapid% *}"
vapid_private="${vapid#* }"

umask 077

# Single quotes keep the bcrypt hash's "$" literal for Compose.
cat > .env <<EOF
DOMAIN=${domain}
BASIC_AUTH_USER=${auth_user}
BASIC_AUTH_HASH='${auth_hash}'
POSTGRES_PASSWORD=${pg_pass}
VALKEY_PASSWORD=${valkey_pass}
EOF

cat > server.env <<EOF
# --- Runtime -----------------------------------------------------------------
# APP_ENV=ci: production build that accepts fake providers for missing keys (test stack only;
# Caddy protects the whole site with basic auth because the dev inbox is enabled).
NODE_ENV=production
APP_ENV=ci
SITE_NOINDEX=1
DATABASE_URL=postgres://parkshield:${pg_pass}@127.0.0.1:5432/parkshield?sslmode=disable
VALKEY_URL=redis://:${valkey_pass}@127.0.0.1:6379/0
SCANNER_BASE_URL=https://${domain}
WEB_BASE_URL=https://${domain}
OPS_BASE_URL=https://${domain}
API_HOST=127.0.0.1
API_PORT=4000
API_INTERNAL_URL=http://127.0.0.1:4000
OPS_API_HOST=127.0.0.1
OPS_API_PORT=4001

# --- Generated secrets (keep; changing DATA_KEY_V1 makes stored data unreadable) --
DATA_KEY_V1=$(key32)
BIDX_KEY=$(key32)
BLOCK_KEY_CURRENT=$(key32)
BLOCK_KEY_PREVIOUS=$(key32)
SESSION_SECRET=$(key32)
VAPID_PUBLIC_KEY=${vapid_public}
VAPID_PRIVATE_KEY=${vapid_private}
VAPID_SUBJECT=mailto:hallo@parkshield.de

# --- Local stand-ins while a provider has no key --------------------------------
PRINT_OUTBOX_DIR=/data/print-outbox
AUDIT_BUCKET_DIR=/data/audit-bucket

# --- Providers (empty = fake adapter) ---------------------------------------------
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
TWILIO_SMS_FROM=
TWILIO_WEBHOOK_BASE_URL=https://${domain}
TWILIO_CONTENT_PS_ALERT_DE=
TWILIO_CONTENT_PS_ALERT_EN=
TWILIO_CONTENT_PS_FOLLOWUP_DE=
TWILIO_CONTENT_PS_FOLLOWUP_EN=
TWILIO_CONTENT_PS_TEST_DE=
TWILIO_CONTENT_PS_TEST_EN=
TWILIO_CONTENT_PS_OTP_DE=
TWILIO_CONTENT_PS_OTP_EN=
MAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=
SENDGRID_REGION=global
MAIL_FROM=ParkShield <hallo@parkshield.de>
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PLUS_YEARLY=
STRIPE_PRICE_PREMIUM_YEARLY=
FRIENDLY_CAPTCHA_SITEKEY=
FRIENDLY_CAPTCHA_API_KEY=
FRIENDLY_CAPTCHA_ENDPOINT=eu
EOF

mkdir -p data/print-outbox data/audit-bucket
chown -R 1000:1000 data # the app containers run as user "node" (uid 1000)

echo "Wrote .env and server.env (mode 600). Add provider keys to server.env, then:"
echo "  docker compose run --rm migrate && docker compose up -d"
