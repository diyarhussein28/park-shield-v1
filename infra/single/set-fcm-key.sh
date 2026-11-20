#!/usr/bin/env bash
# Puts a Firebase service account (app push, FCM) into server.env on the server, then restarts api and
# worker. Run LOCALLY (Git Bash on Windows), with your own SSH key:
#
#   bash infra/single/set-fcm-key.sh ~/Downloads/parkshield-f4861-firebase-adminsdk-XXXX.json [root@<server>]
#
# The JSON comes from Firebase → Project settings → Service accounts → "Generate new private key". It is
# copied to the server, read once into FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY (one line,
# line breaks as \n, as apps/api/src/providers/fcm.ts expects) and shredded there. Delete your local copy
# afterwards. The key itself is never printed. A copy of the old server.env is kept as
# server.env.bak-fcm next to it (delete it once push works).
set -euo pipefail

JSON="${1:?usage: set-fcm-key.sh <service-account.json> [root@<server>]}"
SERVER="${2:-root@test.park-shield.de}"
[[ -s $JSON ]] || { echo "not found: $JSON" >&2; exit 1; }
grep -q '"type": *"service_account"' "$JSON" || { echo "not a service account JSON: $JSON" >&2; exit 1; }

scp -q "$JSON" "$SERVER:/root/fcm-sa.json"
ssh "$SERVER" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/parkshield/src/infra/single
trap 'shred -u /root/fcm-sa.json 2>/dev/null || rm -f /root/fcm-sa.json' EXIT
cp -p server.env server.env.bak-fcm
python3 - /root/fcm-sa.json server.env <<'PY'
import json, sys
sa = json.load(open(sys.argv[1]))
path = sys.argv[2]
values = {
    'FCM_PROJECT_ID': sa['project_id'],
    'FCM_CLIENT_EMAIL': sa['client_email'],
    'FCM_PRIVATE_KEY': sa['private_key'].strip().replace('\n', '\\n'),
}
out, seen = [], set()
for line in open(path).read().splitlines():
    key = line.split('=', 1)[0]
    if key in values:
        out.append(f'{key}={values[key]}')
        seen.add(key)
    else:
        out.append(line)
out += [f'{k}={v}' for k, v in values.items() if k not in seen]
with open(path, 'w') as f:
    f.write('\n'.join(out) + '\n')
print(f"FCM_* set for project {sa['project_id']} ({sa['client_email']})")
PY
docker compose up -d --force-recreate api worker
REMOTE
echo "Done. Now delete the local file: $JSON"
