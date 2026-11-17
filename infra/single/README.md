# Single-server stack (Contabo or Hetzner)

Currently running on a Contabo Cloud VPS (Germany, `test.park-shield.de`). One VM running the website, scanner page, public API, worker, PostgreSQL 18, Valkey and
Caddy (automatic HTTPS) with Docker Compose. It exists to test real providers — first of all the
Twilio WhatsApp/SMS webhooks — on a public HTTPS domain before the full staging topology
(`infra/terraform` + `infra/ansible`: load balancer, five servers, WireGuard, Object Storage) is
built.

**This is not production.** It runs with `APP_ENV=ci`: providers without keys use the fake
adapters and the dev inbox `/dev/postfach` is on. Therefore Caddy puts the whole site behind basic
auth; only `/v1/webhooks/*` stays open (Twilio and Stripe verify by signature). There are no
ops app and no ops API yet. Do not put real customer data on it before production mode.

## Files

| File                | Where it runs | What it does                                                           |
| ------------------- | ------------- | ---------------------------------------------------------------------- |
| `bootstrap.sh`      | server, once  | Docker, Compose, swap, unattended upgrades, SSH keys only              |
| `deploy.sh`         | your computer | ship `origin/main`, build images on the server, migrate, restart       |
| `setup-env.sh`      | server, once  | writes `.env` (Compose/Caddy) and `server.env` (apps) with new secrets |
| `install-backup.sh` | server, once  | backup encryption key + nightly cron (03:15)                           |
| `backup.sh`         | server, cron  | encrypted pg_dump to Object Storage, restore check, 30-day retention   |
| `compose.yml`       | server        | the stack; all containers on the host network, bound to 127.0.0.1      |
| `Caddyfile`         | server        | TLS 1.3, basic auth, privacy-filtered access log, webhooks open        |

`.env`, `server.env` and `data/` exist only on the server (git-ignored, never synced).

## Set-up

1. **Hetzner Cloud console:** create a server — Ubuntu 24.04, location `fsn1` or `nbg1`, at least
   8 GB RAM (the image build needs it; ARM types work), your SSH key. Create a firewall with inbound
   TCP 22, 80, 443 and UDP 443 and attach it.
2. **DNS:** an A record for the test domain (e.g. `staging.parkshield.de`) pointing to the server
   IP. Without a domain, `<ip-with-dashes>.sslip.io` (e.g. `203-0-113-5.sslip.io`) also gets a
   certificate.
3. Prepare the server:
   ```bash
   ssh root@<ip> 'bash -s' < infra/single/bootstrap.sh
   ```
4. Copy the code and build the images (the first run stops after the build):
   ```bash
   infra/single/deploy.sh root@<ip>
   ```
5. Generate the secrets on the server (asks for the basic auth password):
   ```bash
   ssh -t root@<ip> 'cd /opt/parkshield/src/infra/single && bash setup-env.sh <domain> <user>'
   ```
6. Add provider keys on the server (`nano /opt/parkshield/src/infra/single/server.env`). Keys never
   go into the repo or a chat.
7. Deploy again; this migrates the database and starts everything:
   ```bash
   infra/single/deploy.sh root@<ip>
   ```
8. Check: `curl -u <user> https://<domain>/v1/ready`.

Later deploys: step 7 only. After editing `server.env` on the server:
`docker compose up -d --force-recreate api worker web`.

### Deploying as a team

`deploy.sh` is safe to run from several laptops:

- It deploys **exactly the commit `origin/main` points to** (`git archive`), never your working
  tree: push first, then deploy. Uncommitted or unpushed changes are reported and left out.
- It **refuses to roll back**: if the server runs a commit that is not part of `origin/main`
  (for example after `main` was force-pushed), it stops. To undo a bad deploy, `git revert` it on
  `main`, push and deploy again (no flag needed). `ALLOW_ROLLBACK=1` overrides the check and is
  only for a deliberately rewritten `main`.
- **One deploy at a time:** a lock (`/opt/parkshield/deploy.lock`) shows who is deploying. A crashed
  deploy can leave it behind; the error message says how to remove it.
- **History:** `ssh root@<ip> tail /opt/parkshield/deploys.log` (time, person, commit, subject);
  the running commit is in `/opt/parkshield/src/DEPLOYED_COMMIT`.

## Twilio

- `TWILIO_WEBHOOK_BASE_URL` is preset to `https://<domain>`; the signature check uses this exact
  origin.
- WhatsApp sender → "incoming message" URL: `https://<domain>/v1/webhooks/twilio/whatsapp`.
- SMS status callbacks go to `https://<domain>/v1/webhooks/twilio/sms`; the code sets them per
  message.

## Ops app (back office)

The ops API (`ops-api`, :4001) and the ops app (`ops`, :3001) run on the server but listen on
127.0.0.1 only and are not behind Caddy (AD-01: never public). Staff open them through an SSH
tunnel; `OPS_BASE_URL=http://localhost:3001`, so passkeys are registered for `localhost`.

```bash
# on the server, once: first superadmin (prints a one-time link, valid 72 h)
bash ops-invite.sh you@example.com "Your Name" superadmin
# on your computer: keep this open while you use the ops app
ssh -N -L 3001:127.0.0.1:3001 root@<server-ip>
```

Then open the printed link (`http://localhost:3001/einladung#t=…`) in Chrome and register a passkey
(Touch ID, Windows Hello or a security key). Later sign-ins: tunnel + http://localhost:3001.

## Useful commands (on the server, in `/opt/parkshield/src/infra/single`)

```bash
docker compose ps
docker compose logs -f api worker
docker compose exec postgres psql -U parkshield
docker compose down            # stop (data stays in the volumes)
```

## Object Storage (audit log and backups)

Contabo Object Storage, EU, endpoint `https://eu2.contabostorage.com`, region `eu2`. The keys go into
`server.env` by hand (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`AUDIT_BUCKET=parkshield-audit`). Buckets:

- `parkshield-audit`: created with Object Lock (versioning on). The app writes each audit export in
  COMPLIANCE mode; tested: a locked object can neither be deleted nor have its retention shortened.
- `parkshield-backups`: `db/parkshield-<UTC time>.dump.enc`, AES-256 encrypted with
  `/root/parkshield-backup.key`. Keep a copy of that key off the server; without it no backup can be
  read.

Restore by hand (on the server):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/parkshield-backup.key \
  -in /root/backups/<file>.dump.enc > /root/restore.dump
docker compose exec -T postgres pg_restore -U parkshield -h 127.0.0.1 -d <database> --no-owner < /root/restore.dump
```

Log: `/var/log/parkshield-backup.log`. Run one now: `/opt/parkshield/src/infra/single/backup.sh`.
