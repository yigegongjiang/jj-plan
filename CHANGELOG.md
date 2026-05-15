# Changelog

本文件记录 jjplan 的版本变更, 格式参考 [Keep a Changelog](https://keepachangelog.com).

## [0.8.8] - 2026-05-15

### Changed

- **去重 header**: 删 `SpecsView` 内部 `<h3>plans</h3> + N plans · M tasks` 行 / `AsksView` 内部 `<h3>asks</h3> + N asks · standalone · chains` 行 + 整个 `Header` 子组件. ProjectTabs tab bar (`PLANS specCount · taskCount` / `ASKS askCount`) 已承担 section 标识 + 计数职责, 避免 tab 下方紧接一行视觉上几乎相同的文字.
- **沙盒滚动 → 整页滚动**: 删 `ProjectTabs` 容器 `h-[calc(100vh-9rem)] min-h-[20rem]`, 删 `SpecsView` / `AsksView` 的 `<section h-full flex flex-col>` 和内层 `flex-1 min-h-0 overflow-y-auto overflow-x-hidden`. 内容自然伸展, `window` 接管 Y 滚动. ChainGraph 自身的 `overflow-x-auto` 横滚不受影响.
- **mobile scroll-aware 自动隐藏**: 新增 `lib/useScrollDirection.ts` (window scroll 监听 + rAF throttle, scrollY > 60 且 down → `hidden=true`, up 立即 `false`). Dashboard 顶栏与 ProjectTabs tab bar 在 mobile scroll-down 时同步 `-translate-y-full` 隐藏, scroll-up 立即回显, 释放垂直可视空间. 桌面端 `sm:translate-y-0` 永远显示, 行为不变.
- **mobile 紧凑布局**: Dashboard `<header>` 高度 `h-14` → `h-12 sm:h-14`; `<main>` padding `px-4 py-6` → `px-3 py-3 sm:px-4 sm:py-6`; ProjectTabs tab bar `gap-6 py-2` → `gap-4 py-1.5 sm:gap-6 sm:py-2`; tab 计数 mobile 简写 `N · M`, 桌面完整 `N specs · M tasks`.
- **tab bar sticky**: tab bar 加 `sticky top-12 sm:top-14 z-10 bg-zinc-950/90 backdrop-blur` 让其在 window 滚动时贴在顶栏下方, 与顶栏一起 scroll-aware hide. z-index 调整: header z-20 > tab bar z-10 > 内容.

### Notes

- 零 BREAKING. CLI / Worker / Schema / API 零变化. 桌面端布局变化: 内容区不再固定高度沙盒, 长 chain / 多 chain 由整页 scroll 承载, 与 mobile 一致.

## [0.8.7] - 2026-05-15

### Changed

- `ChainGraph` 加 3 层窄屏可感知性 (仅 `chain.length >= 2` 生效, length=1 单 spec 完全保持现状): (a) chain 上方插入一行 header `[链节图标] chain · N items · swipe →`, 首屏即告知"这是 N 节点链", 与独立 item 视觉差异化; (b) 横向滚动容器右沿叠 `pointer-events-none w-8 bg-gradient-to-l from-zinc-950 to-transparent` fade 渐变, 暗示内容向右延伸; (c) chain 第一个 item wrapper 加 `border-l-2 border-zinc-700 pl-1.5` 起点锚, 即便看不到第二个 item 也能识别"链起点".
- 解决 iPhone 视口 ~375-400px 下首个 `AskCard` (`w-[22rem]` ≈ 352px) 几乎占满屏幕、`no-scrollbar` 又隐藏滚动条、用户首屏完全感知不到后续链节点的体验问题. 三处用 ChainGraph (`AsksView` / `SpecsView` / `SpecDetail`) 自动受益, 调用方零改动.

### Notes

- 零 BREAKING. CLI / Worker / Schema / API 零变化. 宽屏不影响 (`min-w-max` 横向布局, fade 仅覆盖右沿).

## [0.8.6] - 2026-05-15

### Changed

- Web project 页 ASKS / PLANS 区由 `SplitPane` 上下拖拽分割改为 **Tab 切换**: 顶部 tab bar 两枚 `PLANS N specs · M tasks` / `ASKS K`, 选中项以 `border-b-2 border-zinc-100` + `font-semibold` 强调, 未选中 `text-zinc-500 hover:text-zinc-300`. 单区块独占内容区高度 (`h-[calc(100vh-9rem)]` 减 tab bar), 解决原 SplitPane 单区最多 90% 的占比受限问题.
- 默认 tab = `PLANS` (jjplan 核心产物), 用户选择持久化到 `localStorage('jjplan_project_tab')`, 值 `plans` | `asks`, 与既有 `jjplan_token` / `jjplan_project_tab` 模式一致.
- 新增 `web/components/ProjectTabs.tsx` (受控 tab 容器 + 计数徽标 + 持久化), 删除 `web/components/SplitPane.tsx` (无其它引用).

### Notes

- 零 BREAKING. CLI / Worker / Schema / API 零变化. 旧 localStorage key `jjplan_split_ratio` 不主动清理 (无副作用, 用户清浏览器即可).

## [0.8.5] - 2026-05-15

### Changed

- Web 控制台品牌名简化: HTML `<title>` 由 `jjplan` 改为 `JJ`; 登录页 H1 由 `jjplan` (text-3xl font-semibold) 升级为 `JJ` (text-5xl font-black tracking-tight), 字号 +2 档、字重至 900、显式高对比白色, 突出极简两字母品牌; 副标题文案 `dashboard · 输入密码以继续` 改为 `console · 输入密码以继续`, 与品牌简化呼应.
- 顶栏面包屑根节点 (登录后所有页面顶部可见) label 由 `jjplan` 改为 `JJ`, 并在 button/span 两种渲染分支下统一应用 `font-black tracking-tight` 高亮样式 (原仅在首页页面态下加粗), 跨页面保持品牌一致.

### Notes

- 零 BREAKING. CLI 名 `jjplan` / `jjask` 不变, Worker/Schema/API/数据模型零变化. 登录页底部"创建 plan / task / ask 请使用 jjplan / jjask CLI"引导文案仍指向真实 CLI 名.

## [0.8.4] - 2026-05-15

### Added

- Web 首页 project 卡片新增 asks 计数: 在原有 `N plans · N tasks` 后追加 `· N asks`, 单复数与既有字段一致 (`1 ask` / `N asks`). 一眼看出每个项目的人机交互记录密度.
- Worker `GET /projects` 响应新增 `asks_count: number` 字段, 用 `COUNT(*) GROUP BY project_id` 一次性聚合, 不嵌入 ask 数组以保持列表接口轻量. 项目无 ask 时计数为 0.

### Notes

- 零 BREAKING. 旧客户端忽略新字段即可; CLI 行为/数据模型零变化.

## [0.8.3] - 2026-05-15

### Changed

- `jjplan --help` / `jjask --help` TLDR 段补 `<project>=cwd basename` 约定: 让 cc (Claude Code) 在交互场景下默认用当前工作目录的 basename 作为 project name, 避免 AI 自由发挥导致 project 名分裂.
- 删 `jjask --help` 三处 "与 jjplan 独立"/"与 jjplan 不同" 强加对比: TLDR / PURPOSE / I/O 段各一处, 改为独立陈述. AI 不需要被告知两者关系, 自会判断.
- `jjask --help` TLDR 段 `--origin` 文案强约束化: 原"决策规则"式两路径并列 (4 行) 压成 1 行强制规则 — `body=改写时 --origin MUST=原话, 不可省`. 修复 cc 改写 body 后漏传 --origin 的高频问题.
- `jjask --help` TLDR 段补 `[--after <prev_ask_id>]` 参数及注释行, 与 `~/.codex/AGENTS.md` (cc/codex 全局规则) 对齐. 原 main.ts TLDR 漏列 --after, 导致 cc 仅读 help 时不知道 ask 可串链.

### Notes

- 零 BREAKING. 用户仍可显式指定任意 project name 覆盖默认. CLI 行为/API/数据模型零变化.

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
