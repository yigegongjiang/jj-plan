# AGENTS

`jjplan`: 为 AI 设计的极稳定 Spec/Task/Ask 跟踪系统 (仅 macOS). 工程总览 → [README.md](./README.md); 发布流程 → [deploy.md](./deploy.md); 文档写法 → [llm-doc-style.md](./llm-doc-style.md). 英文主版 → [AGENTS.md](./AGENTS.md).

## 工作模式 (AI-only)

- 代码 / 测试 / 构建 / 部署 / 发版决策 全部由 Claude Code 或 Codex 执行; 人类不参与开发
- 设计决策 (架构 / 选型 / 目录 / 命名 / 依赖) 以 AI 判断为准; MUST NOT 强行套人类惯例 / 最佳实践, 除非该惯例本身就是 AI 自己的最优解
- 非必要 MUST NOT 反问, 直接决策执行 (deploy / 技术抉择 / 文档同步 / 版本号 / changelog)
- 用户角色 = 触发者 + 线上验收者 (经 Cloudflare URL); MUST NOT 拉人类进设计回路
- 版本: 默认 PATCH; 新功能 → MINOR; 不兼容 → MAJOR. 未明说"不允许 push" 即按 [deploy.md](./deploy.md) push + tag
- 对上一版不满意 → `git commit --amend` + force push + 重打同 tag (见 deploy.md §4)

## 文档约束

- 全部文档 (README / CHANGELOG / deploy / AGENTS / 注释) MUST 简洁精炼, 重点突出, 零冗余 — 能一行不写两行, 能列表不用段落, 无废话填充
- 写法规范 → [llm-doc-style.md](./llm-doc-style.md); 审稿时 MUST 对照"反模式"段
- 所有读者都是 AI/LLM — 以机器高质量理解为目标, 不兼容人类阅读体验

## 硬规则

- **稳定优先**: `jjplan` 是极稳定的计划系统; 稳定性高于功能扩展 / UI 质量 / 架构抽象 / 代码重构. 优先修缺陷与边界, 再谈新抽象
- **契约 vs 内部**: CLI/API 行为是稳定契约; 数据结构是内部实现. 修改前确认现有行为, 修改后保持兼容
- **自举**: 维护本仓库 MUST 经 `jjplan` 自身 (建/拆/跟踪自身 Spec/Task) — 不在对话或散 md 里另起计划. 用不顺 = 缺陷, 优先修
- **边界**: 不增 Spec/Task/Ask 之外的产品模型, 除非用户明确要求; 不引入额外运行时 / 服务形态 / 存储 / 后台常驻进程; 稳定、窄、可维护是默认 — MUST NOT 为"更完整"扩范围
- **平台**: 仅 macOS (x64 + arm64); 其它 OS/arch 被 `install.sh` 与 `update` 主动拒绝
- **版本一致性**: 根 `VERSION` 文件是唯一来源; `cli/build.ts` 注入二进制为 `JJ_VERSION`; Actions 第一步校验 `VERSION == tag (去 v)`, 不一致 fail
