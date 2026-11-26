# icex-dsh-plugin-center

A sidebar page for the icex DSH plugins: install, update, enable, disable and remove them with one click, and keep them updated automatically.

Install it once:

```sh
dsh plugin --profile desktop add icex-dsh-plugin-center
```

Then open **插件中心 / Plugin Center** in the DSH sidebar. Everything else — fixer, memory and future icex plugins — is installed from that page.

## Usage statistics

The page records local counters in `~/.dsh/plugin-center/stats.json`:

- manager: page opens, checks, installs, updates, removals, toggles
- fixer: branch-and-resend count
- memory: candidates captured and digests injected

Counters stay on the machine by default. Turning on **匿名上报 / Anonymous reporting** (and filling in an endpoint) sends one aggregate snapshot per day:

- random install id, DSH version, plugin versions, platform, enabled flags, feature counters
- optional nickname typed by the user
- no prompts, file paths, session text or device name

The receiver is a Cloudflare Worker in this repository: [`cloudflare/`](../../cloudflare). Deploy it once, then paste its `/v1/report` URL into the page. If the machine needs a proxy to reach the Worker, fill in **代理 / Proxy** (for example `http://127.0.0.1:7890`) next to the endpoint; the report request then goes through that proxy. The Worker keeps one row per install per UTC day (idempotent), and its dashboard requires an admin token.
