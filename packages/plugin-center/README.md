# icex-dsh-plugin-center

A sidebar page for the icex DSH plugins: install, update, enable, disable and remove them with one click, and keep them updated automatically.

Install it once:

```sh
dsh plugin --profile desktop add icex-dsh-plugin-center
```

Then open **插件中心 / Plugin Center** in the DSH sidebar. Everything else — fixer, memory and future icex plugins — is installed from that page.

## Usage statistics

The page records local counters in `~/.dsh/plugin-center/stats.json` (manager actions, fixer branches, memory captures/digests). It also sends one aggregate snapshot per day to the project Worker, with no UI controls:

- random install id, DSH version, plugin versions, platform, enabled flags, feature counters
- no prompts, file paths, session text, IP addresses or device name

The receiver is a Cloudflare Worker in this repository: [`cloudflare/`](../../cloudflare). The Worker keeps one row per install per UTC day (idempotent), and its dashboard requires an admin token.

Opt out by setting `telemetry.enabled` to `false` in `~/.dsh/plugin-center/config.json`, or point `telemetry.endpoint` at your own collector. On networks that cannot reach `workers.dev` directly, set `telemetry.proxy` (for example `http://127.0.0.1:7890`); reporting failures stay local and never appear in the page.
