```When Editing
本文档作用: 工程总览 (价值主张 / 使用 / 架构 / 结构); MUST NOT 写发布流程 (→ workflow.md) / LLM 约束 (→ AGENTS.md)
遵循 AGENTS.md 文档编写规范
- 章节按需增删, 只留项目真有的; 首行一行价值主张, MUST NOT 带 LLM 提示
- 短并列项用表格; 可执行步骤 fenced + `#` 注释同行
- NEVER 写「开发」段 (VibeCoding 不向人类解释 dev 命令)
```

# `jj-plan`

AI 专用 Spec/Task/Ask 追踪系统 (macOS only, x64 + arm64). 数据存 Cloudflare D1 (Worker); 两个本地 CLI (`jj-plan` + `jj-ask`) 共用 endpoint + 凭证.

## 使用

```sh
curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
```

一键安装 `jj-plan` + `jj-ask` 到 `$HOME/.local/bin/`. 配置 `~/.config/jj-plan/config.json` (遵循 XDG, 尊重 `$XDG_CONFIG_HOME`; 旧路径 `~/.config/jjplan` 与 `~/.jjplan` 仍作只读 fallback): `endpoint` + 凭证 (bearer `token`, 或 Cloudflare Access service token `cf_access_client_id` + `cf_access_client_secret`). `jj-plan --help` / `jj-ask --help` 查看命令; dashboard 经 Cloudflare Access (Google) 登录.

## 架构

- **模型**: project -> spec -> task (ULID id); ask 按 project 扁平存储
- **技术栈**: Bun CLI (TypeScript) + Cloudflare Worker (D1) + Next.js SPA (静态导出, Worker 托管)
- **认证**: dashboard 经 Cloudflare Access (Google SSO, 无密码); CLI 用 bearer token 或 Cloudflare Access service token (headless); Worker 对受保护路由双认证 (bearer == `JJPLAN_TOKEN` 或校验 Access JWT), 任一通过即放行; endpoint 指向受 Access 保护的自定义域 (workers.dev 旁路入口已关闭)

## 项目结构

<!-- prettier-ignore -->
| 目录 | 职责 |
|---|---|
| `cli/` | CLI 二进制 (`jj-plan` + `jj-ask`), Bun + TypeScript |
| `worker/` | Cloudflare Worker + D1 migrations |
| `web/` | Next.js dashboard SPA (静态导出) |
