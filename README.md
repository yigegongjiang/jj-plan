# jjplan

A Spec/Task/Ask tracker built for AI (macOS only, x64 + arm64). Data lives in Cloudflare D1, exposed via a Worker; two local CLIs (`jjplan` + `jjask`) share one endpoint/token. Chinese mirror → [README.zh.md](./README.zh.md).

## Model

- **Spec** — records plan intent. Three tiers: project -> spec -> task, id = ULID.
- **Task** — breaks a spec down. Status: `todo` / `doing` / `blocked` / `done`. A spec may go `done` only after every task is `done`.
- **Ask** — persists the requests humans throw at the AI (Q&A records); flat, not chained.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
```

Installs both `jjplan` + `jjask` to `$HOME/.local/bin/` in one shot. Configure `~/.jjplan/config.json`:

```json
{ "endpoint": "https://jjplan.<acct>.workers.dev", "token": "<password>" }
```

`wrangler secret put JJPLAN_TOKEN` puts the same token into the Worker.

## Usage

`jjplan --help` / `jjask --help`. Open `endpoint` in a browser for the dashboard.

## Update / Uninstall

`jjplan update` (= `upgrade`) updates both binaries; `uninstall` removes both, config kept.

## Release

Tag → Actions auto-builds + publishes → [deploy.md](./deploy.md).
