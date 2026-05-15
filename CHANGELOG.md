# Changelog

本文件记录 jjplan 的版本变更, 格式参考 [Keep a Changelog](https://keepachangelog.com).

## [0.8.2] - 2026-05-15

### Changed

- Web project 页改为 ASKS / PLANS 上下可拖动分割布局: 新增 `SplitPane` 组件, 默认 50/50, 用户拖动横条调整比例 (clamp 10%-90%), 双击横条重置 50/50. 比例持久化到 `localStorage` (key `jjplan_split_ratio`), 刷新页面沿用上次值.
- 去掉 0.8.1 引入的 ASKS `max-h: 28rem` 固定限高, 改由 SplitPane 控制. ASKS / PLANS 内部各自独立纵向滚动, 不再触发 main 整页滚动.
- 拖动时 `document.body` 临时锁 `user-select: none` + `cursor: row-resize`, 避免选中文本与光标抖动.

### Notes

- 零 BREAKING. API / 数据模型 / ChainGraph / AskCard / SpecNode 不变.
- 容器高度用 `calc(100vh - 9rem)` 减去 header (3.5rem) 与 main padding (3rem) 与余量, 设 `min-h: 20rem` 防止极小窗口下塌陷.

## [0.8.1] - 2026-05-15

### Changed

- Web ASKS 区 UX 重构: 独立 ask (无 prev / 无后续的 length=1 链) 改用 CSS Grid `auto-fill minmax(22rem,1fr)` 多列网格, 1440px 宽屏可排 4 列, 解决原先每张独立卡片独占一行右侧 70% 空白的问题. 真正的链 (length>=2) 仍走 ChainGraph 单行横滚, 链头→尾箭头语义不变.
- ASKS 区整体加 `max-h: 28rem` + `overflow-y-auto`, asks 再多也不会把 PLANS 推下去, 第一屏 PLANS 始终可见.
- ASKS header 计数细化: 同时存在独立 ask 与链时追加 `· K standalone · M chains` 副标签; 单一形态省略副标签避免冗余.
- ChainGraph 横向滚动条 (ASKS 链 / PLANS 链) 隐藏: globals.css 新增 `.no-scrollbar` 工具类 (`scrollbar-width: none` + WebKit `::-webkit-scrollbar { display: none }`), 横向溢出仍可拖动滚动, 仅去掉视觉滚动条占位. 纵向 ASKS 滚动条保留以提示可滚.

### Notes

- 零 BREAKING. 不动 API / 数据模型 / 路由 / 持久化. 仅 `web/components/AsksView.tsx` 内的 className 与渲染分支调整, AskCard / ChainGraph / lib/chain 保持原状.
- AskCard 自身宽度由父级决定 (grid 路径 `w-full`, chains 路径外层包 `w-[22rem] shrink-0`), 行为一致.

## [0.8.0] - 2026-05-15

### Added

- 新增 `jjask` 二进制 (与 `jjplan` 共享一份 CLI 源码), 端点 `/projects/:name/asks` 与 `/asks/:id`, migration `0003_add_asks.sql` 仅 CREATE `asks` 表. Schema/路由/Dashboard 链表与级联沿用 `specs`. `asks` 字段: body (必填) + origin (创建后不可改) + prev_id 单链.
- install.sh 同时安装 `jjplan` + `jjask`, 共用 `~/.jjplan/config.json`.

## [0.7.0] - 2026-05-10

### Changed

- 精简 `jjplan --help` 输出: 162 行 -> 71 行 (-56%), 信息密度优化, 命令行为零变化. 删除 `TYPICAL FLOW` heredoc 示例段、`CONFIG` 路径段、`PITFALLS` (其内容已分散到各命令说明)、推荐 body 模板 (## 背景 / ## 目标 / ## 方案 / ## 兼容性); fork 禁止 / 级联删除 / 中间插入规则集中到 `MODEL` 段一处表述, 各命令说明不再重复; 每条命令统一为「签名 + `->` 返回 + `err:` 错误码」三行结构; `STATUS` 段从 12 行枚举压到 4 行; `EXECUTION` 改名 `BEHAVIOR` 并从 11 行三段式压到 5 条 bullet.

### Notes

- 命令签名、返回 JSON 字段、错误码语义、限长常量、状态枚举与默认值均未变更; 与上一版客户端 / Worker 完全兼容.

## [0.6.0] - 2026-05-10

### Changed

- Web 列表卡片重构 (ProjectsList / SpecsView 的 SpecNode / SpecDetail 的 TaskNode):
  - 宽度从固定 `w-56 / w-48` 改为自适应 `min-w / max-w`, 卡片随标题撑开, 在宽屏下不再过早收窄
  - 标题从 `line-clamp-2 break-words` 改为单行 `truncate` + 原生 `title` tooltip, 极长才省略, 不再过早换行
  - 操作按钮 (edit / delete) 从 `absolute opacity-0 group-hover:opacity-100` 改为底部 footer 与 status 同行, 始终可见, 触屏可达
- 行为零变化, 无 props / API 调整, 仅 className 与 DOM 结构微调.

## [0.5.0] - 2026-05-09

### Changed

- list 排序口径从 `created_at DESC` 切到 `updated_at DESC`. `GET /projects` SQL 加 `ORDER BY updated_at DESC`, `orderSpecs` 链头排序基准跟进, web `buildChains` 删除二次内存排序. 现有客户端无需改动, 列表里"最近活动过"的 project / spec 会自动浮到最前.
- 任意 mutation (POST / PATCH / DELETE × spec / task) 现在级联 bump 父链 `updated_at`: 改 task 同步刷新所属 spec + project; 改 spec 同步刷新所属 project. 每个 mutation 用 D1 batch + shared ts 把"自身写入 + 父级 bump"打成原子事务.

### Notes

- DELETE 路径的父级 bump 加 `NOT EXISTS` 守卫, CAS 失败时 `updated_at` 不被错误推进.
- 历史数据 `created_at == updated_at`, 排序口径切换不会颠倒已有顺序. 无 schema 变更, 无新 migration.
- worker 内部 `buildPatch` 签名从内取 `now()` 改为外部传 `ts`, 让父级 bump 与自身写入用同一时间戳.

## [0.4.0] - 2026-05-09

### Changed (BREAKING)

- spec status 由 `draft | active | done` 简化为 `active | done`. 新建 spec 默认值由 `draft` 改为 `active`. 推荐流变为 `active -> done`. `draft` 与 `active` 在原模型中无任何代码层差异, 仅是文档建议, 删之.
- 旧客户端 `PATCH /specs/:id` 传 `status="draft"` 将返回 400. 升级 CLI / Web 即可.
- migration `0002_drop_draft.sql` 把存量 `draft` 行就地改为 `active`, 不丢数据.

### Notes

- task 状态保持 `todo | doing | done | blocked` 不变. blocked 与其他三态正交, 信息独立, 保留.

## [0.3.0] - 2026-05-09

### Added

- `jjplan task new <spec_id> <title> [--after <prev_task_id>]`: 支持在指定 task 之后插入新 task, 中间插入时原后继的 prev_id 自动重连到新 task (A->B->C, `--after A` 新建 X => A->X->B->C). 不传 --after 维持原行为 (追加链尾).
- `POST /specs/:id/tasks` 接受可选 body 字段 `prev_id`. 协议向后兼容: 旧客户端不传该字段, 走原自动追加路径.
- Web Dashboard: 已登录后每 5s 静默自动刷新, tab 从隐藏切回时立即触发一次, 让 CLI 端改动在数秒内反映到页面. 协议未变.

## [0.2.0] - 2026-05-09

### Changed

- 重写 `jjplan --help` 输出, 使 AI 能从单次帮助调用完整掌握 CLI 能力: 数据模型 (project ⊃ spec ⊃ task)、I/O 协定 (stdin/stdout/exit code)、每命令意图与返回 JSON 形状、状态语义与流转、典型工作流示例、常见陷阱.
