# jjplan

为 AI 设计的 Spec/Task/Ask 跟踪 (仅 macOS, x64 + arm64). 数据在 Cloudflare D1, 经 Worker 暴露; 本地两个 CLI (`jjplan` + `jjask`) 共用 endpoint/token. 英文主版 → [README.md](./README.md).

## 模型

- **Spec** — 记录计划意图. 三层: project -> spec -> task, id = ULID.
- **Task** — 拆解 Spec. 状态: `todo` / `doing` / `blocked` / `done`. 所有 task `done` 后 spec 才可 `done`.
- **Ask** — 持久化人类抛给 AI 的请求 (Q&A 记录); 扁平, 不串链.

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
```

一条命令同时装 `jjplan` + `jjask` 到 `$HOME/.local/bin/`. 配置 `~/.jjplan/config.json`:

```json
{ "endpoint": "https://jjplan.<acct>.workers.dev", "token": "<password>" }
```

`wrangler secret put JJPLAN_TOKEN` 把同一 token 塞进 Worker.

## 用法

`jjplan --help` / `jjask --help`. 浏览器开 `endpoint` 看 dashboard.

## 更新 / 卸载

`jjplan update` (= `upgrade`) 同时更新两个二进制; `uninstall` 同理两个都卸, config 保留.

## 发布

tag → Actions 自动构建 + 发布 → [deploy.md](./deploy.md).
