# jjplan

> **AI-only project**: 本仓库由 Claude Code / Codex 独立维护. 用户 = 触发者 + 验收者, 不是协作开发者. 设计 / 编码 / 发版全部 AI 决策, 不参考人类惯例.

为 AI 设计的 Spec/Task/Ask 跟踪 (仅 macOS, x64 + arm64). 数据在 Cloudflare D1, 经 Worker 暴露; 本地两个 CLI (`jjplan` + `jjask`) 共用 endpoint/token.

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
```

一条命令同时装 `jjplan` + `jjask` 到 `$HOME/.local/bin/`. 配置 `~/.jjplan/config.json`:

```json
{ "endpoint": "https://jjplan.<acct>.workers.dev", "token": "<password>" }
```

`wrangler secret put JJPLAN_TOKEN` 把同一 token 塞进 Worker.

## 用

`jjplan --help` / `jjask --help`. 浏览器开 `endpoint` 看 dashboard.

## 更新 / 卸载

`jjplan update` (= `upgrade`) 同时更新两个二进制; `uninstall` 同理两个都卸, config 保留.
