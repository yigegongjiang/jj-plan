/**
 * jjplan CLI — thin HTTP client for the jjplan Worker.
 *
 * Responsibilities (kept deliberately narrow):
 *   1. Read ~/.jjplan/config.json for {endpoint, token}.
 *   2. Translate `jjplan <noun> <verb> ...` into one HTTP call.
 *   3. Print the JSON response to stdout.
 *   4. On any error, write a one-line message to stderr and exit non-zero.
 *
 * Project scoping: spec.new / spec.ls take a `<project>` positional argument
 * supplied by the caller (the AI passes the basename of its working
 * directory). The Worker upserts the project on first sight; the CLI never
 * inspects the local filesystem for it. Spec ids are ULIDs and globally
 * unique, so spec show/set/rm and all task commands remain project-agnostic.
 *
 * No local state, no caching, no retries. Business logic lives in the Worker.
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

declare const JJPLAN_VERSION: string | undefined;

const CONFIG_PATH = join(homedir(), '.jjplan', 'config.json');
const INSTALL_URL =
  'https://raw.githubusercontent.com/yangfan-elestyle/jj-plan/main/install.sh';

const SPEC_STATUSES = ['draft', 'active', 'done'] as const;
const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 65536;
const MAX_PROJECT_NAME_LEN = 128;

const USAGE = {
  help: 'jjplan --help',
  version: 'jjplan --version',
  'self-update': 'jjplan self-update',
  uninstall: 'jjplan uninstall',
  'project.ls': 'jjplan project ls',
  'project.rm': 'jjplan project rm <name>',
  'spec.new': 'jjplan spec new <project> <title> [--after <prev_spec_id>]',
  'spec.ls': 'jjplan spec ls <project>',
  'spec.show': 'jjplan spec show <id>',
  'spec.set': `jjplan spec set <id> [--title T] [--body B] [--status ${SPEC_STATUSES.join('|')}]`,
  'spec.rm': 'jjplan spec rm <id>',
  'task.new': 'jjplan task new <spec_id> <title> [--after <prev_task_id>]',
  'task.ls': 'jjplan task ls <spec_id>',
  'task.set': `jjplan task set <id> [--title T] [--body B] [--status ${TASK_STATUSES.join('|')}]`,
  'task.rm': 'jjplan task rm <id>',
} as const;

type UsageKey = keyof typeof USAGE;

interface Config {
  endpoint: string;
  token: string;
}

function resolveVersion(): string {
  if (typeof JJPLAN_VERSION === 'string' && JJPLAN_VERSION.length > 0) {
    return JJPLAN_VERSION;
  }

  try {
    const raw = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
    if (raw.length > 0) return raw;
  } catch {
    // Source-tree fallback only. Release builds inject JJPLAN_VERSION.
  }

  return 'dev';
}

const VERSION = resolveVersion();

// ─── error helper ──────────────────────────────────────────────────────────

function die(message: string): never {
  process.stderr.write(`jjplan: ${message.replace(/\s+/g, ' ').trim()}\n`);
  process.exit(1);
}

function dieUsage(command: UsageKey, reason: string): never {
  die(`${reason}; usage: ${USAGE[command]}`);
}

// ─── config + HTTP ─────────────────────────────────────────────────────────

function loadConfig(): Config {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    die(`unable to read ${CONFIG_PATH}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    die(`invalid JSON in ${CONFIG_PATH}: ${(e as Error).message}`);
  }
  const cfg = parsed as Partial<Config>;
  if (typeof cfg.endpoint !== 'string' || typeof cfg.token !== 'string') {
    die(`${CONFIG_PATH} must contain {"endpoint":"...","token":"..."}`);
  }
  return { endpoint: cfg.endpoint, token: cfg.token };
}

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const cfg = loadConfig();
  const url = cfg.endpoint.replace(/\/+$/, '') + path;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    die(`network error: ${(e as Error).message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    die(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204 || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    die(`non-JSON response: ${text.slice(0, 200)}`);
  }
}

function readStdin(): string {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function print(value: unknown): void {
  if (value === null || value === undefined) return;
  process.stdout.write(JSON.stringify(value) + '\n');
}

// ─── flag parsing for `set` commands ──────────────────────────────────────

interface PatchFlags {
  title?: string;
  body?: string;
  status?: string;
}

function validateTitle(title: string): void {
  if (title.length === 0 || title.length > MAX_TITLE_LEN) {
    die(`title length must be 1..${MAX_TITLE_LEN}`);
  }
}

function validateBody(body: string): void {
  if (body.length > MAX_BODY_LEN) {
    die(`body too long (max ${MAX_BODY_LEN} chars)`);
  }
}

function validateProject(name: string): void {
  if (name.length === 0 || name.length > MAX_PROJECT_NAME_LEN) {
    die(`project name length must be 1..${MAX_PROJECT_NAME_LEN}`);
  }
}

function parseSetFlags(
  args: string[],
  allowedStatuses: readonly string[],
  command: UsageKey,
): PatchFlags {
  let result;
  try {
    result = parseArgs({
      args,
      options: {
        title: { type: 'string' },
        body: { type: 'string' },
        status: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (e) {
    dieUsage(command, (e as Error).message);
  }

  const flags = result.values as PatchFlags;
  if (Object.keys(flags).length === 0) {
    dieUsage(command, 'no fields provided');
  }
  if (flags.status !== undefined && !allowedStatuses.includes(flags.status)) {
    dieUsage(command, `invalid status '${flags.status}'; allowed: ${allowedStatuses.join('|')}`);
  }
  if (flags.title !== undefined) validateTitle(flags.title);
  if (flags.body !== undefined) validateBody(flags.body);
  return flags;
}

function parseSpecNewArgs(args: string[]): { project: string; title: string; prevId?: string } {
  let project: string | undefined;
  let title: string | undefined;
  let prevId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--after') {
      if (prevId !== undefined) dieUsage('spec.new', 'duplicate --after');
      prevId = args[++i];
      if (typeof prevId !== 'string' || prevId.length === 0 || prevId.startsWith('--')) {
        dieUsage('spec.new', 'missing <prev_spec_id> after --after');
      }
    } else if (arg.startsWith('--')) {
      dieUsage('spec.new', `unknown option ${arg}`);
    } else if (project === undefined) {
      project = arg;
    } else if (title === undefined) {
      title = arg;
    } else {
      dieUsage('spec.new', `unexpected argument ${arg}`);
    }
  }

  if (project === undefined) dieUsage('spec.new', 'missing <project>');
  if (title === undefined) dieUsage('spec.new', 'missing <title>');
  validateProject(project);
  validateTitle(title);
  return prevId ? { project, title, prevId } : { project, title };
}

function parseTaskNewArgs(args: string[]): { specId: string; title: string; prevId?: string } {
  let specId: string | undefined;
  let title: string | undefined;
  let prevId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--after') {
      if (prevId !== undefined) dieUsage('task.new', 'duplicate --after');
      prevId = args[++i];
      if (typeof prevId !== 'string' || prevId.length === 0 || prevId.startsWith('--')) {
        dieUsage('task.new', 'missing <prev_task_id> after --after');
      }
    } else if (arg.startsWith('--')) {
      dieUsage('task.new', `unknown option ${arg}`);
    } else if (specId === undefined) {
      specId = arg;
    } else if (title === undefined) {
      title = arg;
    } else {
      dieUsage('task.new', `unexpected argument ${arg}`);
    }
  }

  if (specId === undefined) dieUsage('task.new', 'missing <spec_id>');
  if (title === undefined) dieUsage('task.new', 'missing <title>');
  validateTitle(title);
  return prevId ? { specId, title, prevId } : { specId, title };
}

function requireNoArgs(args: string[], command: UsageKey): void {
  if (args.length > 0) dieUsage(command, `unexpected argument ${args[0]}`);
}

function requireId(id: string | undefined, rest: string[], command: UsageKey): string {
  if (!id || id.startsWith('--')) dieUsage(command, 'missing <id>');
  if (rest.length > 0) dieUsage(command, `unexpected argument ${rest[0]}`);
  return id;
}

// ─── command handlers ─────────────────────────────────────────────────────

type Handler = (rest: string[]) => Promise<void>;

const commands: Record<string, Handler> = {
  async 'project.ls'(rest) {
    requireNoArgs(rest, 'project.ls');
    print(await api('GET', '/projects'));
  },

  async 'project.rm'([name, ...rest]) {
    if (!name || name.startsWith('--')) dieUsage('project.rm', 'missing <name>');
    if (rest.length > 0) dieUsage('project.rm', `unexpected argument ${rest[0]}`);
    await api('DELETE', `/projects/${encodeURIComponent(name)}`);
  },

  async 'spec.new'(args) {
    const { project, title, prevId } = parseSpecNewArgs(args);
    const body = readStdin();
    validateBody(body);
    const payload: { title: string; body: string; prev_id?: string } = {
      title,
      body,
    };
    if (prevId) payload.prev_id = prevId;
    print(await api('POST', `/projects/${encodeURIComponent(project)}/specs`, payload));
  },

  async 'spec.ls'([project, ...rest]) {
    if (!project || project.startsWith('--')) dieUsage('spec.ls', 'missing <project>');
    if (rest.length > 0) dieUsage('spec.ls', `unexpected argument ${rest[0]}`);
    validateProject(project);
    print(await api('GET', `/projects/${encodeURIComponent(project)}/specs`));
  },

  async 'spec.show'([id, ...rest]) {
    id = requireId(id, rest, 'spec.show');
    print(await api('GET', `/specs/${encodeURIComponent(id)}`));
  },

  async 'spec.set'([id, ...rest]) {
    id = requireId(id, [], 'spec.set');
    const flags = parseSetFlags(rest, SPEC_STATUSES, 'spec.set');
    print(await api('PATCH', `/specs/${encodeURIComponent(id)}`, flags));
  },

  async 'spec.rm'([id, ...rest]) {
    id = requireId(id, rest, 'spec.rm');
    await api('DELETE', `/specs/${encodeURIComponent(id)}`);
  },

  async 'task.new'(args) {
    const { specId, title, prevId } = parseTaskNewArgs(args);
    const body = readStdin();
    validateBody(body);
    const payload: { title: string; body: string; prev_id?: string } = { title, body };
    if (prevId) payload.prev_id = prevId;
    print(await api('POST', `/specs/${encodeURIComponent(specId)}/tasks`, payload));
  },

  async 'task.ls'([specId, ...rest]) {
    if (!specId || specId.startsWith('--')) dieUsage('task.ls', 'missing <spec_id>');
    if (rest.length > 0) dieUsage('task.ls', `unexpected argument ${rest[0]}`);
    const spec = await api('GET', `/specs/${encodeURIComponent(specId)}`);
    const tasks = (spec as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) die('unexpected response: tasks missing');
    print(tasks);
  },

  async 'task.set'([id, ...rest]) {
    id = requireId(id, [], 'task.set');
    const flags = parseSetFlags(rest, TASK_STATUSES, 'task.set');
    print(await api('PATCH', `/tasks/${encodeURIComponent(id)}`, flags));
  },

  async 'task.rm'([id, ...rest]) {
    id = requireId(id, rest, 'task.rm');
    await api('DELETE', `/tasks/${encodeURIComponent(id)}`);
  },
};

// ─── self-update / help / version ─────────────────────────────────────────

function runInstaller(args: string[]): void {
  const suffix = args.length > 0 ? ` -s -- ${args.join(' ')}` : '';
  try {
    execSync(`curl -fsSL ${INSTALL_URL} | bash${suffix}`, { stdio: 'inherit' });
  } catch {
    die(args.includes('--uninstall') ? 'uninstall failed' : 'self-update failed');
  }
}

function printHelp(): void {
  process.stdout.write(
    `jjplan ${VERSION}

# PURPOSE
Spec/Task 计划跟踪 CLI, 专为 AI 调用设计. 数据存远端 Cloudflare D1, 本地是无状态客户端.
工作循环: 接需求 -> 写 SPEC -> 拆 TASK -> 推 status (todo->doing->done) -> SPEC 收尾.

# DATA MODEL
project (name, 主键)
  -- spec (id=ULID, 同项目内可形成 0..N 条独立链)
       -- task (id=ULID, 每个 spec 一条严格链)

- project 自动 upsert: spec new 首次提及该 project 名即创建; 无 \`project new\`.
- spec 链: --after 连接 (A->B->C); 不允许 fork (同一 prev_id 至多一个后继).
- task 链: --after 连接, 不传则追加链尾; 中间插入会把原后继自动接到新 task (A->B->C, --after A 新建 X => A->X->B->C). 不允许 fork.
- 删中间节点自动接续: A->B->C 删 B 后变 A->C.

# I/O CONTRACT
- 输入: 位置参数 + flag; body 字段在 \`new\` 命令中从 stdin 读 (TTY 检测, 无 stdin = 空 body).
- 输出: 单行 JSON 到 stdout; DELETE 类返回空 (HTTP 204).
- 错误: 单行 stderr \`jjplan: <msg>\` + 非零 exit code; 客户端不重试.
- id 一律 ULID; 必须从响应 JSON 抓取, 不可凭空构造.
- 限长: title 1..${MAX_TITLE_LEN}, body 0..${MAX_BODY_LEN}, project 1..${MAX_PROJECT_NAME_LEN} (chars).

# META
jjplan help | --help          打印本帮助
jjplan --version              打印版本
jjplan self-update            重装最新版本; 仅在用户明确要求时执行
jjplan uninstall              卸载; 仅在用户明确要求时执行

# PROJECT
jjplan project ls
  列所有 project, 嵌套展开 specs (链序) 与 tasks (链序), 一次拉完.
  -> [{name, created_at, updated_at, specs:[{...spec, tasks:[...task]}]}]

jjplan project rm <name>
  删 project; cascade 删该项目下全部 specs 与 tasks. 不可逆.
  -> 空 | 404 项目不存在.

# SPEC
jjplan spec new <project> <title> [--after <prev_spec_id>]
  在 project 下新建 spec; status 固定为 \`draft\`; body 从 stdin 读.
  推荐 body 结构: ## 背景 / ## 目标 / ## 方案 / ## 兼容性.
  --after: 接在 prev_spec_id 之后; prev 必须同项目且尚无后继.
  -> {id, project_id, title, body, status:"draft", prev_id, created_at, updated_at}
  错误: 400 prev 跨项目/不存在 | 409 prev 已有后继.

jjplan spec ls <project>
  列项目内所有 spec (链序, 多条独立链按各自 head 的 created_at 倒序),
  每个 spec 内嵌 tasks (链序).
  -> [{...spec, tasks:[...task]}] | 404 项目不存在.

jjplan spec show <id>
  读单个 spec, 内嵌 tasks (链序).
  -> {...spec, tasks:[...task]} | 404.

jjplan spec set <id> [--title T] [--body B] [--status ${SPEC_STATUSES.join('|')}]
  改 spec; 至少传一个 flag. --body 是完整覆盖 (非追加), 多行 markdown 用
  --body "$(cat file.md)".
  -> {...spec} | 400 无字段/status 非法 | 404.

jjplan spec rm <id>
  删 spec; cascade 删该 spec 所有 task; 链中前后自动接续. 不可逆.
  -> 空 | 404 | 409 并发冲突 (重读后再试).

# TASK
jjplan task new <spec_id> <title> [--after <prev_task_id>]
  在 spec 下新建 task; status 固定为 \`todo\`; body 从 stdin 读.
  默认追加到该 spec 的 task 链尾.
  --after: 接在 prev_task_id 之后; 若 prev 有后继, 原后继的 prev_id 自动改为新 task (A->B->C, --after A => A->X->B->C). prev 必须同 spec.
  推荐 body 结构: 操作步骤 (1./2./3.) + 验收条件 + 涉及文件路径.
  -> {id, spec_id, title, body, status:"todo", prev_id, created_at, updated_at}
  错误: 400 prev 跨 spec/不存在 | 404 spec 不存在 (仅在不传 --after 时触发) | 409 并发竞争 (重试).

jjplan task ls <spec_id>
  列该 spec 的 task (链序). 等价于 \`spec show <spec_id>\` 取 .tasks 字段.
  -> [...task] | 404 spec 不存在.

jjplan task set <id> [--title T] [--body B] [--status ${TASK_STATUSES.join('|')}]
  改 task; 至少传一个 flag. --body 是完整覆盖 (非追加).
  -> {...task} | 400 | 404.

jjplan task rm <id>
  删 task; 链中前后自动接续. 不可逆.
  -> 空 | 404 | 409.

# STATUS 语义与流转
spec
  draft   刚 spec new, 仍在规划; 可反复 spec set 修订 title/body.
  active  已开始执行 (推荐: 创建首个 task 时一并切到 active).
  done    语义完成态; 所有 task 已 done 后再切.
  推荐流: draft -> active -> done.

task
  todo    待办. 默认状态.
  doing   正在执行. 推荐一次仅一条 task 处于 doing.
  done    语义完成态.
  blocked 受阻 (依赖未满足/外部资源/需用户决策). 切到 blocked 时把原因写入 body;
          解除后切回 todo 或 doing.
  推荐流: todo -> doing -> done; 任何非 done 状态可临时 -> blocked.

注: 系统不做状态机硬校验, 任何状态间均可切换; 由 AI 主动遵循上述规则.

# EXECUTION 执行规则
何时依序: 遇链式结构沿 prev_id 从头推进, 不跳序.
- task 是严格单链, 必须按链序 todo -> doing -> done.
- spec 经 --after 串成链 (A -> B -> C) 时, 必须先完成 A 才开始 B.
- 单节点 spec (无 --after, 无后继) 不构成链, 独立执行即可.

何时按用户指定: 链中部分节点已 done 但仍有节点未 done 时, 用户可显式点名某个 id 跳过链序直接推进.
- 适用: 中段 task 仍 todo/blocked, 用户指定先做后段某条; 或先解 blocked 项的外部依赖.
- AI 不得自作主张跳序; 唯一脱链途径是用户明确指定目标 id.

判定流程:
1. 用户未指定 id -> 沿当前 spec 的 task 链找首个非 done 项推进.
2. 用户指定 id -> 按该 id 推进, 即使前序未全 done.
3. spec 整体切 done 必须在其所有 task 都已 done 之后.

# TYPICAL FLOW
# 1. 接需求, 写 SPEC (body 从 stdin)
cat <<'MD' | jjplan spec new myrepo "添加 GitHub OAuth 登录"
## 背景
现有仅密码登录.
## 目标
支持 GitHub OAuth, 不破坏既有 session.
## 方案
1. 加 oauth_tokens 表
2. /auth/github 路由
3. 前端登录页加按钮
## 兼容性
旧 token 继续有效.
MD
# -> {"id":"01HX...","status":"draft",...}

# 2. 切 active, 开始拆 task
jjplan spec set 01HX... --status active

# 3. 拆 task (body 从 stdin)
cat <<'MD' | jjplan task new 01HX... "schema: oauth_tokens 表"
1. 写 worker/migrations/0002_oauth.sql
2. wrangler d1 migrations apply
验收: 新表存在, 测试通过.
MD
# -> {"id":"01HY...","status":"todo",...}

# 4. 推进 task
jjplan task set 01HY... --status doing
# ...写代码...
jjplan task set 01HY... --status done

# 5. 该 spec 下所有 task 已 done, 收尾 spec
jjplan spec set 01HX... --status done

# PITFALLS
- 命令是 \`jjplan <noun> <verb> ...\` (空格分隔), 不要写成 \`jjplan spec.new\`.
- body 在 \`spec new\` / \`task new\` 中只能从 stdin 读; \`spec set\` / \`task set\`
  改 body 用 --body flag (非 stdin).
- project 没有 \`new\` 子命令; 必须靠 \`spec new\` 首次写入触发 upsert.
- 删除 project 下所有 spec 不会自动删除 project; 只有 \`project rm\` 会删除 project.
- id 一律 ULID, 必须从前一条响应 JSON 取; 不可凭空构造或截断.
- spec 不允许 fork: 同一 prev_spec_id 只能被一条 spec 引用; 二次引用返回 409.
- 删除 (project rm / spec rm / task rm) 都是不可逆的, 仅在用户明确要求时执行.
- 客户端不重试 409; 拿到后应重新查询当前状态再决策.

# CONFIG
${CONFIG_PATH}
  {"endpoint":"https://jjplan.<acct>.workers.dev","token":"<password>"}
`,
  );
}

// ─── entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '-h' || argv[0] === '--help') {
    if (argv.length > 1) dieUsage('help', `unexpected argument ${argv[1]}`);
    printHelp();
    return;
  }
  if (argv[0] === '-v' || argv[0] === '--version') {
    if (argv.length > 1) dieUsage('version', `unexpected argument ${argv[1]}`);
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv[0] === 'self-update') {
    if (argv.length > 1) dieUsage('self-update', `unexpected argument ${argv[1]}`);
    runInstaller([]);
    return;
  }
  if (argv[0] === 'uninstall') {
    if (argv.length > 1) dieUsage('uninstall', `unexpected argument ${argv[1]}`);
    runInstaller(['--uninstall']);
    return;
  }

  const [noun, verb, ...rest] = argv;
  const handler = commands[`${noun}.${verb}`];
  if (!handler) {
    die(`unknown command '${[noun, verb].filter(Boolean).join(' ')}'; usage: ${USAGE.help}`);
  }
  await handler(rest);
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
