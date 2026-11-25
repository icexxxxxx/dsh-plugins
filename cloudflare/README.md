# icex usage collector (Cloudflare Worker + D1)

Receives the opt-in anonymous snapshot sent by `icex-dsh-plugin-center`.

## Fields

- `installId`: random UUID created on first run, stored in `~/.dsh/plugin-center/stats.json`
- `appVersion`, `platform`, `arch`, `locale`
- per-plugin: `name`, `version`, `installed`, `enabled`, feature counters
- `nickname`: optional, whatever the user typed (empty by default)
- `days`: last 30 days of local activity totals

No prompts, file paths, session text, device name or IP are stored. One row per install per UTC day; retries are idempotent.

## Deploy

```bash
npm install -g wrangler
wrangler login
wrangler d1 create icex-plugin-stats          # copy database_id
cp wrangler.toml.example wrangler.toml        # paste database_id
wrangler d1 execute icex-plugin-stats --file schema.sql --remote
wrangler secret put ADMIN_TOKEN               # choose a long random token
wrangler deploy
```

The worker URL is `https://icex-plugin-stats.<account>.workers.dev`.

## Dashboard

Open the worker root URL and enter `ADMIN_TOKEN` to see:

- unique installs and today's active installs
- daily activity (last 30 days)
- DSH version and platform distribution
- per-plugin enablement and feature counters
- optional nicknames

`GET /v1/stats?token=...` returns the same data as JSON.

## Local development

```bash
wrangler dev --local --persist-to .wrangler
# in another shell
curl -X POST http://127.0.0.1:8787/v1/report \
  -H 'content-type: application/json' \
  -d '{"schema":1,"installId":"11111111-1111-1111-1111-111111111111","generatedAt":"2026-01-01T00:00:00.000Z","appVersion":"0.2.2-rc.5","platform":"darwin","plugins":[{"name":"icex-dsh-fixer","version":"0.3.12","enabled":true,"counts":{"branch":2}}],"manager":{"pageOpen":3}}'
curl 'http://127.0.0.1:8787/v1/stats?token=dev' -H 'x-admin-token: dev'
```

Set `ADMIN_TOKEN` in `.dev.vars` for local runs.
