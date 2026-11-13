# Single-server test stack (Hetzner)

One Hetzner VM running the website, scanner page, public API, worker, PostgreSQL 18, Valkey and
Caddy (automatic HTTPS) with Docker Compose. It exists to test real providers — first of all the
Twilio WhatsApp/SMS webhooks — on a public HTTPS domain before the full staging topology
(`infra/terraform` + `infra/ansible`: load balancer, five servers, WireGuard, Object Storage) is
built.

**This is not production.** It runs with `APP_ENV=ci`: providers without keys use the fake
adapters and the dev inbox `/dev/postfach` is on. Therefore Caddy puts the whole site behind basic
auth; only `/v1/webhooks/*` stays open (Twilio and Stripe verify by signature). There are no
backups, no ops app and no ops API. Do not put real customer data on it.

## Files

| File           | Where it runs | What it does                                                           |
| -------------- | ------------- | ---------------------------------------------------------------------- |
| `bootstrap.sh` | server, once  | Docker, Compose, swap, unattended upgrades, SSH keys only              |
| `deploy.sh`    | your computer | rsync the working tree, build images on the server, migrate, restart   |
| `setup-env.sh` | server, once  | writes `.env` (Compose/Caddy) and `server.env` (apps) with new secrets |
| `compose.yml`  | server        | the stack; all containers on the host network, bound to 127.0.0.1      |
| `Caddyfile`    | server        | TLS 1.3, basic auth, privacy-filtered access log, webhooks open        |

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

## Twilio

- `TWILIO_WEBHOOK_BASE_URL` is preset to `https://<domain>`; the signature check uses this exact
  origin.
- WhatsApp sender → "incoming message" URL: `https://<domain>/v1/webhooks/twilio/whatsapp`.
- SMS status callbacks go to `https://<domain>/v1/webhooks/twilio/sms`; the code sets them per
  message.

## Useful commands (on the server, in `/opt/parkshield/src/infra/single`)

```bash
docker compose ps
docker compose logs -f api worker
docker compose exec postgres psql -U parkshield
docker compose down            # stop (data stays in the volumes)
```
