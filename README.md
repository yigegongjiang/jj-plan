```When Editing
本文档作用: 工程总览 (价值主张 / 使用 / 架构 / 结构); MUST NOT 写发布流程 (→ workflow.md) / LLM 约束 (→ AGENTS.md)
遵循 AGENTS.md 文档编写规范
- 章节按需增删, 只留项目真有的; 首行一行价值主张, MUST NOT 带 LLM 提示
- 短并列项用表格; 可执行步骤 fenced + `#` 注释同行
- NEVER 写「开发」段 (VibeCoding 不向人类解释 dev 命令)
```

# `jjplan`

AI 专用 Spec/Task/Ask 追踪系统 (macOS only, x64 + arm64). 数据存 Cloudflare D1 (Worker); 两个本地 CLI (`jjplan` + `jjask`) 共用 endpoint/token.

## 使用

```sh
curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
```

一键安装 `jjplan` + `jjask` 到 `$HOME/.local/bin/`. 配置 `~/.jjplan/config.json` 填入 `endpoint` + `token`. `jjplan --help` / `jjask --help` 查看命令; 浏览器访问 `endpoint` 打开 dashboard.

## 架构

- **模型**: project -> spec -> task (ULID id); ask 按 project 扁平存储
- **技术栈**: Bun CLI (TypeScript) + Cloudflare Worker (D1) + Next.js SPA (静态导出, Worker 托管)

## 项目结构

<!-- prettier-ignore -->
| 目录 | 职责 |
|---|---|
| `cli/` | CLI 二进制 (`jjplan` + `jjask`), Bun + TypeScript |
| `worker/` | Cloudflare Worker + D1 migrations |
| `web/` | Next.js dashboard SPA (静态导出) |
