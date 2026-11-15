#!/usr/bin/env bash
# Daily PostgreSQL backup of the single-server stack, run by cron ON THE SERVER (install-backup.sh):
#   1. pg_dump (custom format) from the running postgres container,
#   2. encrypted with AES-256 (key: /root/parkshield-backup.key, never leaves the server; keep an
#      offline copy, without it the backups cannot be read),
#   3. uploaded to s3://$BACKUP_BUCKET/db/ (Contabo Object Storage, credentials from server.env),
#   4. restore check: the new dump is decrypted and restored into a scratch database, which must
#      contain the users table, then dropped,
#   5. backups older than $KEEP_DAYS days are deleted from the bucket; the last 3 stay on disk.
# Exit code != 0 on any failure, so cron mails/logs it.
set -euo pipefail

cd "$(dirname "$0")"
BACKUP_BUCKET="${BACKUP_BUCKET:-parkshield-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
KEY=/root/parkshield-backup.key
DIR=/root/backups
AWS_IMAGE=amazon/aws-cli:2.22.35
mkdir -p "$DIR"
chmod 700 "$DIR"

[[ -s $KEY ]] || { echo "missing $KEY (run install-backup.sh)" >&2; exit 1; }
endpoint="$(grep '^S3_ENDPOINT=' server.env | cut -d= -f2-)"
[[ -n $endpoint ]] || { echo "S3_ENDPOINT missing in server.env" >&2; exit 1; }

# The S3 keys are handed to the CLI container through a root-only file, never on the command line.
creds="$(mktemp)"
trap 'rm -f "$creds"' EXIT
grep -E '^S3_(ACCESS|SECRET)_KEY=' server.env |
  sed -e 's/^S3_ACCESS_KEY=/AWS_ACCESS_KEY_ID=/' -e 's/^S3_SECRET_KEY=/AWS_SECRET_ACCESS_KEY=/' >"$creds"
s3() {
  docker run --rm -v "$DIR:/w" --env-file "$creds" -e AWS_DEFAULT_REGION=default \
    "$AWS_IMAGE" --endpoint-url "$endpoint" "$@"
}

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="parkshield-$ts.dump.enc"

echo "[$ts] dump"
docker compose exec -T postgres pg_dump -U parkshield -h 127.0.0.1 -Fc parkshield |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY" -out "$DIR/$file"
size="$(stat -c %s "$DIR/$file")"
[[ $size -gt 1000 ]] || { echo "dump suspiciously small ($size bytes)" >&2; exit 1; }

echo "[$ts] upload $file ($size bytes)"
s3 s3 cp "/w/$file" "s3://$BACKUP_BUCKET/db/$file" --only-show-errors

echo "[$ts] restore check"
docker compose exec -T postgres psql -U parkshield -h 127.0.0.1 -d postgres -qc \
  'DROP DATABASE IF EXISTS restore_check' -c 'CREATE DATABASE restore_check'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY" -in "$DIR/$file" |
  docker compose exec -T postgres pg_restore -U parkshield -h 127.0.0.1 -d restore_check --no-owner
tables="$(docker compose exec -T postgres psql -U parkshield -h 127.0.0.1 -d restore_check -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
users="$(docker compose exec -T postgres psql -U parkshield -h 127.0.0.1 -d restore_check -tAc \
  'SELECT count(*) FROM users')"
docker compose exec -T postgres psql -U parkshield -h 127.0.0.1 -d postgres -qc \
  'DROP DATABASE restore_check'
[[ $tables -gt 20 ]] || { echo "restore check failed: only $tables tables" >&2; exit 1; }
echo "[$ts] restore ok: $tables tables, $users users"

echo "[$ts] prune (bucket: older than $KEEP_DAYS days, disk: keep 3)"
cutoff="$(date -u -d "-$KEEP_DAYS days" +%Y%m%dT%H%M%SZ)"
s3 s3 ls "s3://$BACKUP_BUCKET/db/" | awk '{print $4}' | while read -r old; do
  stamp="${old#parkshield-}"
  stamp="${stamp%.dump.enc}"
  if [[ -n $stamp && $stamp < $cutoff ]]; then
    s3 s3 rm "s3://$BACKUP_BUCKET/db/$old" --only-show-errors
    echo "  removed $old"
  fi
done
ls -1t "$DIR"/parkshield-*.dump.enc | tail -n +4 | xargs -r rm -f
echo "[$ts] done"
