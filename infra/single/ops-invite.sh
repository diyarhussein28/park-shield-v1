#!/usr/bin/env bash
# Creates a staff account on this stack and prints a one-time passkey set-up link for the ops app.
# Same steps as scripts/ops-invite.ts (which needs the repo's dev tooling): user + roles + audit entry
# in one transaction, only the SHA-256 of the token in Valkey for 72 hours.
# Run ON THE SERVER in /opt/parkshield/src/infra/single:
#   bash ops-invite.sh you@example.com "Your Name" superadmin [more roles...]
set -euo pipefail
cd "$(dirname "$0")"

email="$(printf '%s' "${1:?usage: ops-invite.sh <e-mail> \"<name>\" <role> [role...]}" | tr '[:upper:]' '[:lower:]')"
name="${2:?name missing}"
shift 2
(($# > 0)) || { echo "at least one role is required" >&2; exit 2; }
roles="$(printf '%s\n' "$@" | sort -u | paste -sd, -)"

user_id="$(
  docker compose exec -T postgres psql -U parkshield -d parkshield -qtA -v ON_ERROR_STOP=1 \
    -v email="$email" -v name="$name" -v roles="$roles" <<'SQL'
BEGIN;
SELECT count(*) = array_length(string_to_array(:'roles', ','), 1) AS roles_known
  FROM staff_roles WHERE code = ANY (string_to_array(:'roles', ',')) \gset
\if :roles_known
\else
  \echo 'unknown role in' :'roles'
  \quit
\endif
SELECT EXISTS (SELECT 1 FROM users WHERE email = :'email' AND kind <> 'staff') AS is_customer \gset
\if :is_customer
  \echo 'this e-mail belongs to a customer account'
  \quit
\endif
INSERT INTO users (email, kind, display_name, email_verified_at)
  SELECT :'email', 'staff', :'name', now()
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = :'email');
SELECT id AS uid FROM users WHERE email = :'email' \gset
DELETE FROM staff_role_assignments WHERE user_id = :'uid';
INSERT INTO staff_role_assignments (user_id, role_code)
  SELECT :'uid', unnest(string_to_array(:'roles', ','));
INSERT INTO audit_logs (actor_id, actor_kind, action, entity, entity_id, meta)
  VALUES (NULL, NULL, 'staff.invite', 'users', :'uid',
          jsonb_build_object('roles', to_jsonb(string_to_array(:'roles', ',')), 'via', 'cli'));
COMMIT;
SELECT :'uid';
SQL
)"
if ! [[ "$(printf '%s' "$user_id" | tail -n1)" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "$user_id" >&2   # the reason psql printed; nothing was committed
  exit 1
fi
user_id="$(printf '%s' "$user_id" | tail -n1)"

token="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
hash="$(printf '%s' "$token" | sha256sum | cut -d' ' -f1)"
set -a; . ./.env; set +a
docker compose exec -T valkey valkey-cli --no-auth-warning -a "$VALKEY_PASSWORD" \
  SET "ops:invite:$hash" "$user_id" EX $((72 * 3600)) >/dev/null

ops_base="$(grep -E '^OPS_BASE_URL=' server.env | cut -d= -f2-)"
echo "Staff account $email ($roles). Passkey set-up link, valid 72 h:"
echo "${ops_base}/einladung#t=${token}"
