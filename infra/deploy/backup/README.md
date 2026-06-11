# Mongo + keyFile S3 backup — operator runbook

This directory holds the **nightly backup job** for the production 3-node
MongoDB replica set (`rs0`) plus the on-disk replica-set keyFile, and the
**operator-driven restore** that pulls a chosen snapshot back out of S3.

The job runs **inside a sidecar container** (`backup` service in
`infra/docker/docker-compose.prod.yml`) on the same isolated `ruletka-net`
network the mongod nodes use, so it reaches `mongo1/2/3:27017` directly
without any port being published to the internet.

## Files

| Path | What it does |
|------|--------------|
| `backup-mongo.sh` | The nightly job. `mongodump --archive --gzip` → tar of `/etc/mongo-keyfile` → S3 upload → retention sweep → optional webhook ping. |
| `restore-mongo.sh` | Operator-facing restore. Lists snapshots from S3 desc, downloads the chosen one, `mongorestore --drop`. Refuses to run against the prod RS URI without `FORCE_RESTORE_PROD=1`. |
| (compose) `backup` service | Alpine image with `awscli` + `mongodb-database-tools` + `cron`. Entrypoint installs the crontab below and `exec`s `crond -f`. |

## Cron schedule

```
30 3 * * *   /usr/local/bin/backup-mongo.sh
```

**Daily at 03:30 UTC** — chosen to fall in the lowest-traffic hour across both
RU and EU evenings (06:30 MSK, 04:30 CEST, 22:30 prev-day MDT). The dump uses
`--readPreference=secondaryPreferred`, so the read load lands on a secondary
when one is healthy and the primary stays responsive to live traffic.

Edit the compose service's `BACKUP_CRON` env if you need a different time
(format = standard 5-field cron, **UTC** — the alpine container's TZ stays at
UTC and is intentionally NOT changed; mixing local TZs across containers makes
retention math harder to reason about).

## Retention policy

`BACKUP_RETENTION_DAYS` — **default 30**. After every successful upload, the
script lists every snapshot prefix under `mongo/`, parses the timestamp out of
the prefix name (it's the `YYYYMMDDTHHMMSSZ` we wrote on upload), and deletes
any whose timestamp sorts **strictly before** the cutoff computed as
`date -u -d "$BACKUP_RETENTION_DAYS days ago" +%Y%m%dT%H%M%SZ`.

The lexicographic string compare works because the timestamp shape is
fixed-width with leading zeroes → string sort = chronological sort.

Bucket lifecycle rules ARE NOT used (they were considered) — Timeweb-S3 and
some other S3-compatible providers do not honour lifecycle rules reliably. A
script-driven sweep is the portable answer.

## Required env vars (live in `/opt/ruletka/.env`)

| Key | Purpose | Example |
|-----|---------|---------|
| `S3_BACKUP_BUCKET` | Bucket name. Create it in the Timeweb-S3 console with **private ACL** + **server-side encryption ON**. | `ruletka-backups-prod` |
| `S3_BACKUP_ACCESS_KEY_ID` | Access key id with `s3:PutObject` + `s3:DeleteObject` + `s3:ListBucket` ONLY on this bucket. **Do not reuse the operator's root credentials.** | `TWA1234567890ABCDEF` |
| `S3_BACKUP_SECRET_ACCESS_KEY` | Matching secret. Treated like a JWT secret. | `…` |
| `S3_BACKUP_REGION` | Bucket region. | `ru-1` (Timeweb) or `us-east-1` (AWS) |
| `S3_BACKUP_ENDPOINT_URL` | Custom S3 endpoint. The script ALWAYS passes `--endpoint-url`, so any S3-compatible provider works. | `https://s3.timeweb.cloud` |
| `BACKUP_RETENTION_DAYS` | Retention window. Defaults to 30 if unset. | `30` |
| `ALERT_WEBHOOK_URL` | OPTIONAL. POSTed a small JSON `{status, timestamp, bucket, key_prefix, message}` on success and failure. Track O (Telegram alerting) wires its bot URL here once it lands → backup pings show up in the operator channel automatically. | `https://hooks.example.com/...` |

These are also pre-listed in `.env.example` with full inline explanations.

The Mongo creds (`MONGO_APP_USERNAME` / `MONGO_APP_PASSWORD`) the dump uses are
the same ones the API connects with — they already live in `.env` and the
compose `backup` service inherits them, so there's nothing extra to install.

## Timeweb-S3 bucket setup (one-time)

1. Console → **Cloud storage** → **Create bucket** → name `ruletka-backups-prod`,
   region `ru-1`, **ACL: private**.
2. Tab **Encryption** → **enable** server-side encryption (AES-256 is fine —
   the dump is already encrypted at the application layer via the
   replica-set keyFile, but bucket-level encryption is the standard belt-and-
   braces).
3. Tab **Access keys** → **Create key** → permissions limited to **this bucket**
   (PutObject / DeleteObject / ListBucket). Save both halves immediately —
   Timeweb shows the secret exactly once.
4. Paste both into `/opt/ruletka/.env` per the snippet in
   `SECRETS-INSTALL.md` §9 (see "Apply" below).
5. Restart the backup sidecar:
   `docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d --no-deps backup`.
6. **Verify**: `docker compose exec backup /usr/local/bin/backup-mongo.sh`
   should finish with `SUCCESS:` and the snapshot should appear in the bucket.

For AWS S3 or another provider, the only thing that changes is the
`S3_BACKUP_ENDPOINT_URL` (and possibly `S3_BACKUP_REGION`).

## Restore drill (run quarterly)

The whole point of a backup is that you've actually tried restoring from one
before the day you need to. The drill is cheap; **run it once a quarter** and
record the result in `LAUNCH-CHECKLIST.md`.

### Drill A — restore into a throwaway local Mongo

1. SSH to a workstation (or the staging box). Start a clean single-node Mongo:
   ```bash
   docker run -d --rm --name mongo-restore-drill -p 37017:27017 mongo:7 \
     mongod --replSet rs0 --bind_ip_all
   sleep 5
   docker exec mongo-restore-drill mongosh --quiet --eval '
     try { rs.status(); } catch (e) { rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]}); }
   '
   ```
2. Pull the latest dump out of S3 with the same creds the backup uses:
   ```bash
   aws --endpoint-url "$S3_BACKUP_ENDPOINT_URL" s3 ls \
       "s3://$S3_BACKUP_BUCKET/mongo/" | tail -5
   aws --endpoint-url "$S3_BACKUP_ENDPOINT_URL" s3 cp \
       "s3://$S3_BACKUP_BUCKET/mongo/<TS>/dump.gz" /tmp/drill.gz
   ```
3. Restore against the throwaway:
   ```bash
   mongorestore --uri='mongodb://localhost:37017/?directConnection=true' \
                --gzip --archive=/tmp/drill.gz --drop
   ```
4. Sanity check counts vs prod:
   ```bash
   mongosh 'mongodb://localhost:37017/ruletka?directConnection=true' \
     --quiet --eval 'print(db.users.countDocuments()); print(db.payments.countDocuments())'
   ```
5. Tear it down: `docker stop mongo-restore-drill`.

### Drill B — full-cluster rebuild from a snapshot

This is the **disaster-recovery** path: you've lost the data volumes (and
potentially the host) and need to come back up from scratch.

1. Provision a fresh VPS, install Docker + Compose, clone the repo.
2. Run `bash infra/deploy/bootstrap.sh` with the operator-supplied
   `SMTP_PASS` / `TURNSTILE_*` AND the `S3_BACKUP_*` from your vault. Bootstrap
   will generate a NEW Mongo keyFile + root/app passwords — you will then
   overwrite the keyFile with the one from the snapshot in step 4, AND
   overwrite the four `MONGO_*` env values with the ones in your vault that
   match the data in the snapshot (otherwise the app user inside the
   restored db won't match the password in `.env`).
3. Stop the stack: `docker compose -f infra/docker/docker-compose.prod.yml down`.
4. Pull `keyfile.tgz` from S3 for the snapshot you'll restore, extract it
   into `infra/secrets/`:
   ```bash
   aws --endpoint-url "$S3_BACKUP_ENDPOINT_URL" s3 cp \
       "s3://$S3_BACKUP_BUCKET/mongo/<TS>/keyfile.tgz" /tmp/kf.tgz
   tar xzf /tmp/kf.tgz -C /tmp
   mv /tmp/etc/mongo-keyfile infra/secrets/mongo-keyfile
   chmod 400 infra/secrets/mongo-keyfile
   chown 999:999 infra/secrets/mongo-keyfile
   ```
5. Bring the Mongo nodes back up:
   `docker compose -f infra/docker/docker-compose.prod.yml up -d mongo1 mongo2 mongo3 mongo-init`.
6. Restore the dump from inside the `backup` sidecar:
   ```bash
   docker compose -f infra/docker/docker-compose.prod.yml up -d backup
   docker compose -f infra/docker/docker-compose.prod.yml exec \
     -e BACKUP_NAME=<TS> -e SKIP_CONFIRM=1 \
     -e MONGODB_URI="mongodb://root:<root-pw>@mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0&authSource=admin" \
     -e FORCE_RESTORE_PROD=1 \
     backup /usr/local/bin/restore-mongo.sh
   ```
   `FORCE_RESTORE_PROD=1` is **required** here — the prod guard in the script
   exists exactly so you can't do this by accident.
7. Bring the rest of the stack up:
   `docker compose -f infra/docker/docker-compose.prod.yml up -d`.
8. Smoke test: API `/api/health` returns ok, a quick login works.

## Alerting integration

`backup-mongo.sh` POSTs a small JSON body to `ALERT_WEBHOOK_URL` on both
success and failure (the field is `status: "success" | "failure"`). The
Telegram alerting track (**track O**) wires this same URL to its bot, so the
moment that bot lands the operator channel will start receiving the nightly
"OK / FAIL" ping with no additional change here.

Until that lands, leave `ALERT_WEBHOOK_URL` blank — the script is a clean
no-op (no network traffic, no errors) when it's unset.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `S3_BACKUP_BUCKET not set` on first run | The operator never installed `S3_BACKUP_*` into `.env`. | Follow the snippet in `SECRETS-INSTALL.md` §9 + restart the `backup` service. |
| Snapshot uploaded but missing for next day | Cron didn't fire — most often the `backup` container was restarted DURING the window and `crond` came up after 03:30. | `docker compose exec backup crontab -l` to confirm the entry; manually run `/usr/local/bin/backup-mongo.sh` once. |
| `mongodump` errors with "Authentication failed" | The MONGO_APP_PASSWORD in `.env` no longer matches the one in the db (rotated). | Re-sync — update `.env`, run `mongosh` to change the user password to match, restart the `backup` sidecar. |
| Retention sweep deletes nothing on day 31 | The TS prefix in the bucket doesn't match `YYYYMMDDTHHMMSSZ` (someone uploaded by hand). | Rename or delete the rogue prefix; the sweep is defensive and skips anything that doesn't match the shape. |
| Bucket fills up despite retention working | Something other than this script is writing to `mongo/` (e.g. a manual `aws s3 cp`). | The sweep only knows about its own format. Clean up by hand. |

## Files NOT in scope

This runbook deliberately doesn't cover:

- **Redis backup** — Redis is a cache + pub/sub channel + presence store; all
  three are reconstructible (presence via heartbeats, BullMQ jobs re-fire).
  No backup needed.
- **`/opt/ruletka/.env`** — back this up out-of-band into your password
  manager. It is NOT included in this S3 job because the bucket creds are
  themselves IN that file; circular-restore is a footgun.
- **`infra/secrets/mongo-keyfile`** — the keyFile IS included in every
  snapshot (the `keyfile.tgz`), which is the path that matters for restoring
  data into an existing cluster.
