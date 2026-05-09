# Changelog

本文件记录 jjplan 的版本变更, 格式参考 [Keep a Changelog](https://keepachangelog.com).

## [0.3.0] - 2026-05-09

### Added

- `jjplan task new <spec_id> <title> [--after <prev_task_id>]`: 支持在指定 task 之后插入新 task, 中间插入时原后继的 prev_id 自动重连到新 task (A->B->C, `--after A` 新建 X => A->X->B->C). 不传 --after 维持原行为 (追加链尾).
- `POST /specs/:id/tasks` 接受可选 body 字段 `prev_id`. 协议向后兼容: 旧客户端不传该字段, 走原自动追加路径.
- Web Dashboard: 已登录后每 5s 静默自动刷新, tab 从隐藏切回时立即触发一次, 让 CLI 端改动在数秒内反映到页面. 协议未变.

## [0.2.0] - 2026-05-09

### Changed

- 重写 `jjplan --help` 输出, 使 AI 能从单次帮助调用完整掌握 CLI 能力: 数据模型 (project ⊃ spec ⊃ task)、I/O 协定 (stdin/stdout/exit code)、每命令意图与返回 JSON 形状、状态语义与流转、典型工作流示例、常见陷阱.
