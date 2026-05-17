# jjplan agent rules

## AI-only 工程声明

本仓库由 **Claude Code / Codex 独立维护**, 人类不参与开发. 用户 = 触发者 + 验收者, 不是协作开发者. 具体约束:

1. 代码 / 测试 / 构建 / 部署 / 发版决策全部由 AI 执行.
2. 设计决策 (架构 / 技术选型 / 目录 / 命名 / 依赖) 以 AI 判断为准, **不参考人类开发者的惯例/最佳实践**, 除非该惯例本身就是 AI 自己的最优解.
3. 非必要不反问用户, 直接决策并执行 (deploy / 技术抉择 / 文档同步 / 版本号 / changelog 等).
4. 所有文档 (README / CHANGELOG / deploy.md / CLAUDE.md / 代码注释) 必须**简洁精炼、零冗余** — 能一行不写两行, 能列表不用段落, 不堆砌背景 / 客套 / 重复. 宁可信息密度过载, 不要废话填充.

## 目标

`jjplan`: 极稳定的 Spec/Task 计划系统. 稳定性优先级高于功能扩展、UI 质量、架构抽象和代码重构.

## 核心能力

- Spec：记录计划意图.
- Task：拆解 Spec.
- Status：`todo` / `doing` / `blocked` / `done`.
- Completion：所有 Task `done` 后, Spec 才可 `done`.

## 开发方式

- CLI/API 行为是稳定契约; 数据结构是内部实现.
- 修改前确认现有行为; 修改后保持兼容.
- 新能力必须落在 Spec / Task 工作流内.
- 优先修缺陷与边界; 直接实现优先于新抽象.

### For AI/LLM/Claude code /Codex

- 默认 PATCH (第三位) bump; 新功能 → MINOR; 不兼容 → MAJOR.
- 用户未明说"不允许 push" 即按 [deploy.md](./deploy.md) push + tag (用户经 Cloudflare URL 自行验收).
- 对上一版的调整不满意 → `git commit --amend` + force push + 重打同 tag (见 deploy.md §4).
- 改完代码 → `CHANGELOG.md` 顶部新增版本段 (Added / Changed / Fixed, 面向用户精简摘要) → 发布.

## 工程约束

- 平台: 仅 macOS (x64 + arm64); 其它 OS/arch 被 `install.sh` 与 `update` 主动拒绝.
- 版本一致性: 根 `VERSION` 唯一来源, `cli/build.ts` define `JJ_VERSION` 注入二进制; Actions 第一步校验 `VERSION == tag (去 v)`, 不一致 fail.

## 自举

`jjplan` CLI 已可实际使用. 维护本工程必须经 `jjplan` 建/拆/跟踪自身 Spec/Task, 不在对话或散 md 里另起计划. 用不顺 = 缺陷, 优先修.

## 边界

- 不追求复杂 UI; 页面只需稳定可用.
- 不增 Spec / Task 之外的产品模型, 除非用户明确要求.
- 不引入额外运行时、服务形态、存储或后台常驻进程.
- 不为"更完整"扩展范围; 稳定、窄、可维护是默认.

## 文本内容要求

所有文本读者都是 AI/LLM, 不需要兼容人类阅读体验, 能让 AI 高质量理解即可.
