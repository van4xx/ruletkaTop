# Auto-deploy (server-side pull)

ruletka.top auto-deploys by **pulling** from GitHub on the server, not by being
pushed to. GitHub's Azure-hosted runners can't hold a reliable connection to this
Timeweb box (the path drops at ~2m23s — same lossy link that broke ACME http-01),
so a `systemd` timer on the server checks `origin/main` every minute and runs the
idempotent `bootstrap.sh` when there are new commits. A `git push` is live in ~60s.

## One-time install (as root on the server)

```bash
cd /opt/ruletka
git fetch origin main && git reset --hard origin/main
chmod +x infra/deploy/auto-deploy.sh
cp infra/deploy/systemd/ruletka-autodeploy.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now ruletka-autodeploy.timer
systemctl list-timers ruletka-autodeploy.timer --no-pager   # should be scheduled
```

## Watch / operate

```bash
tail -f /opt/ruletka/auto-deploy.log              # deploy history + build output
journalctl -u ruletka-autodeploy.service -f       # systemd view of each run
systemctl start ruletka-autodeploy.service        # force a deploy check right now
systemctl disable --now ruletka-autodeploy.timer  # pause auto-deploy
```

The script (`infra/deploy/auto-deploy.sh`) is `flock`-guarded, so a long build never
overlaps the next minute's tick, and it's a fast no-op whenever the checkout is
already up to date.
