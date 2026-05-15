// Thin HTTP client for the jjplan Worker. One source, two binaries:
// build:jjask injects JJPLAN_ENTRY='jjask'; default 'jjplan' so source-tree
// `bun run src/main.ts` works. No local state, no retries.
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

declare const JJPLAN_VERSION: string | undefined;
declare const JJPLAN_ENTRY: string | undefined;

const CONFIG_PATH = join(homedir(), '.jjplan', 'config.json');
const INSTALL_URL =
  'https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh';

const ENTRY_NAME: 'jjplan' | 'jjask' =
  typeof JJPLAN_ENTRY === 'string' && JJPLAN_ENTRY === 'jjask' ? 'jjask' : 'jjplan';

const SPEC_STATUSES = ['active', 'done'] as const;
const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 65536;
const MAX_PROJECT_NAME_LEN = 128;

const ASK_LIMIT_DEFAULT = 3;
const ASK_LIMIT_MAX = 100;

const USAGE = {
  help: `${ENTRY_NAME} --help`,
  version: `${ENTRY_NAME} --version`,
  'self-update': `${ENTRY_NAME} self-update`,
  uninstall: `${ENTRY_NAME} uninstall`,
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
  'ask.new': 'jjask new <project> <body> [--origin <body>] [--after <prev_ask_id>]',
  'ask.ls': `jjask ls <project> [--limit N]   (default ${ASK_LIMIT_DEFAULT}, max ${ASK_LIMIT_MAX})`,
  'ask.show': 'jjask show <id>',
  'ask.set': 'jjask set <id> --body <body>',
  'ask.rm': 'jjask rm <id>',
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
  process.stderr.write(`${ENTRY_NAME}: ${message.replace(/\s+/g, ' ').trim()}\n`);
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

function parseAskNewArgs(args: string[]): {
  project: string;
  body: string;
  origin?: string;
  prevId?: string;
} {
  let project: string | undefined;
  let body: string | undefined;
  let origin: string | undefined;
  let prevId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--after') {
      if (prevId !== undefined) dieUsage('ask.new', 'duplicate --after');
      prevId = args[++i];
      if (typeof prevId !== 'string' || prevId.length === 0 || prevId.startsWith('--')) {
        dieUsage('ask.new', 'missing <prev_ask_id> after --after');
      }
    } else if (arg === '--origin') {
      if (origin !== undefined) dieUsage('ask.new', 'duplicate --origin');
      const v = args[++i];
      if (typeof v !== 'string') dieUsage('ask.new', 'missing <body> after --origin');
      origin = v;
    } else if (arg.startsWith('--')) {
      dieUsage('ask.new', `unknown option ${arg}`);
    } else if (project === undefined) {
      project = arg;
    } else if (body === undefined) {
      body = arg;
    } else {
      dieUsage('ask.new', `unexpected argument ${arg}`);
    }
  }

  if (project === undefined) dieUsage('ask.new', 'missing <project>');
  if (body === undefined) dieUsage('ask.new', 'missing <body>');
  validateProject(project);
  if (body.length === 0 || body.length > MAX_BODY_LEN) {
    dieUsage('ask.new', `body length must be 1..${MAX_BODY_LEN}`);
  }
  if (origin !== undefined && origin.length > MAX_BODY_LEN) {
    dieUsage('ask.new', `origin too long (max ${MAX_BODY_LEN} chars)`);
  }
  const out: { project: string; body: string; origin?: string; prevId?: string } = { project, body };
  if (origin !== undefined) out.origin = origin;
  if (prevId !== undefined) out.prevId = prevId;
  return out;
}

function parseAskLsArgs(args: string[]): { project: string; limit?: number } {
  let project: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--limit') {
      if (limit !== undefined) dieUsage('ask.ls', 'duplicate --limit');
      const v = args[++i];
      if (typeof v !== 'string' || v.startsWith('--')) {
        dieUsage('ask.ls', 'missing <N> after --limit');
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > ASK_LIMIT_MAX) {
        dieUsage('ask.ls', `--limit must be integer in 1..${ASK_LIMIT_MAX}`);
      }
      limit = n;
    } else if (arg.startsWith('--')) {
      dieUsage('ask.ls', `unknown option ${arg}`);
    } else if (project === undefined) {
      project = arg;
    } else {
      dieUsage('ask.ls', `unexpected argument ${arg}`);
    }
  }

  if (project === undefined) dieUsage('ask.ls', 'missing <project>');
  validateProject(project);
  return limit !== undefined ? { project, limit } : { project };
}

function parseAskSetArgs(args: string[]): { id: string; body: string } {
  let id: string | undefined;
  let body: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--body') {
      if (body !== undefined) dieUsage('ask.set', 'duplicate --body');
      const v = args[++i];
      if (typeof v !== 'string') dieUsage('ask.set', 'missing <body> after --body');
      body = v;
    } else if (arg.startsWith('--')) {
      dieUsage('ask.set', `unknown option ${arg}`);
    } else if (id === undefined) {
      id = arg;
    } else {
      dieUsage('ask.set', `unexpected argument ${arg}`);
    }
  }

  if (id === undefined) dieUsage('ask.set', 'missing <id>');
  if (body === undefined) dieUsage('ask.set', 'missing --body');
  if (body.length === 0 || body.length > MAX_BODY_LEN) {
    dieUsage('ask.set', `body length must be 1..${MAX_BODY_LEN}`);
  }
  return { id, body };
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

  async 'ask.new'(args) {
    const { project, body, origin, prevId } = parseAskNewArgs(args);
    const payload: { body: string; origin?: string; prev_id?: string } = { body };
    if (origin !== undefined) payload.origin = origin;
    if (prevId) payload.prev_id = prevId;
    print(await api('POST', `/projects/${encodeURIComponent(project)}/asks`, payload));
  },

  async 'ask.ls'(args) {
    const { project, limit } = parseAskLsArgs(args);
    const q = limit !== undefined ? `?limit=${limit}` : '';
    print(await api('GET', `/projects/${encodeURIComponent(project)}/asks${q}`));
  },

  async 'ask.show'([id, ...rest]) {
    id = requireId(id, rest, 'ask.show');
    print(await api('GET', `/asks/${encodeURIComponent(id)}`));
  },

  async 'ask.set'(args) {
    const { id, body } = parseAskSetArgs(args);
    print(await api('PATCH', `/asks/${encodeURIComponent(id)}`, { body }));
  },

  async 'ask.rm'([id, ...rest]) {
    id = requireId(id, rest, 'ask.rm');
    await api('DELETE', `/asks/${encodeURIComponent(id)}`);
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
  if (ENTRY_NAME === 'jjask') {
    printJjaskHelp();
    return;
  }
  printJjplanHelp();
}

function printJjplanHelp(): void {
  process.stdout.write(
    `jjplan ${VERSION}

# TLDR
jjplan: AI 用的 Spec/Task 跟踪 CLI. 三层模型 project -> spec -> task, id=ULID. <project>=cwd basename.
循环: 写 spec 立计划 -> 拆 task -> 推 task status (todo/doing/done/blocked) -> 所有 task done 后 spec set done.

  jjplan spec new <project> <title>     # body 从 stdin 读; project 不存在自动建
  jjplan task new <spec_id> <title>     # body 从 stdin 读; 默认追加链尾, --after <id> 中间插
  jjplan task set <id> --status <s>     # 亦可改 --title/--body
  jjplan spec set <id> --status done    # 收尾, 需所有 task 已 done

输出: stdout 单行 JSON. 查询/删除/错误码/链语义见 jjplan --help.

# PURPOSE
为 AI 设计的 Spec/Task 跟踪 CLI.

# MODEL
project (name, 主键) -- spec (id=ULID) -- task (id=ULID)
- project 自动 upsert: spec new 首次提及即创建; 无 \`project new\`.
- spec/task 用 --after 串成单链, 禁止 fork (一个 prev 至多一个后继, 二次引用 -> 409).
- 中间删/插自动接续: A->B->C 删 B => A->C; --after A 插 X => A->X->B->C.
- 级联删除 (不可逆): project rm 删其下全部 spec+task; spec rm 删其下全部 task.

# I/O
- 输出: stdout 单行 JSON; DELETE 返回空 (HTTP 204).
- 错误: stderr 单行 \`jjplan: <msg>\` + 非零 exit; 客户端不重试.
- new 命令的 body 从 stdin 读 (无 stdin = 空 body); set 改 body 用 --body flag, 整体覆盖.
- id 一律 ULID, 必须从响应 JSON 取, 不可构造或截断.
- 限长 (chars): title 1..${MAX_TITLE_LEN}, body 0..${MAX_BODY_LEN}, project 1..${MAX_PROJECT_NAME_LEN}.

# COMMANDS

jjplan --help | --version
jjplan self-update | uninstall          仅在用户明确要求时执行

jjplan project ls
  -> [{name, created_at, updated_at, specs:[{...spec, tasks:[...task]}]}]
jjplan project rm <name>
  err: 404

jjplan spec new <project> <title> [--after <prev_spec_id>]
  -> {id, project_id, title, body, status:"active", prev_id, created_at, updated_at}
  err: 400 prev 跨项目/不存在 | 409 prev 已有后继
jjplan spec ls <project>
  -> [{...spec, tasks:[...task]}]   (链序)
  err: 404
jjplan spec show <id>
  -> {...spec, tasks:[...task]}
  err: 404
jjplan spec set <id> [--title T] [--body B] [--status ${SPEC_STATUSES.join('|')}]
  至少传一个 flag.
  -> {...spec}
  err: 400 无 flag/status 非法 | 404
jjplan spec rm <id>
  err: 404 | 409 并发

jjplan task new <spec_id> <title> [--after <prev_task_id>]
  不传 --after 追加链尾.
  -> {id, spec_id, title, body, status:"todo", prev_id, created_at, updated_at}
  err: 400 prev 跨 spec/不存在 | 404 spec 不存在 (仅无 --after 时) | 409 并发
jjplan task ls <spec_id>
  -> [...task]   (链序)
  err: 404
jjplan task set <id> [--title T] [--body B] [--status ${TASK_STATUSES.join('|')}]
  至少传一个 flag.
  -> {...task}
  err: 400 | 404
jjplan task rm <id>
  err: 404 | 409 并发

# STATUS
spec  active (默认, 含立项与执行中) | done (所有 task done 后切)
task  todo (默认) -> doing -> done; 任意非 done 可 -> blocked
blocked: 切入时原因写 body, 解除后回 todo/doing.
系统不强制状态机, 任意状态可互切, 由 AI 自律.

# BEHAVIOR
- 默认沿 task 链找首个非 done 推进, 不跳序.
- spec 链必须按链序完成: A->B->C, A done 才进 B.
- 用户显式指定 id => 跳序推进; AI 不得自行跳序.
- spec done 必须在其所有 task done 之后.
- 拿到 409 不重试, 重新查询当前状态再决策.
`,
  );
}

function printJjaskHelp(): void {
  process.stdout.write(
    `jjask ${VERSION}

# TLDR
jjask: 落盘人类抛给 AI 的请求 (Q&A 记录). 两层模型 project -> ask, id=ULID. <project>=cwd basename.

  jjask new <project> <body> [--origin <原话>] [--after <prev_ask_id>]
    # body=喂后续 AI 的最终输入. body=原话则省 --origin; body=改写 (原话口语化/含糊) 则 --origin MUST=原话, 不可省.
    # --after: 接在上一条 ask 之后成链 (同一会话的追问/补充)

输出: stdout 单行 JSON. body/origin 不读 stdin (位置/flag 参数). 查询/修改/删除见 jjask --help.

# PURPOSE
落盘人类抛给 AI 的请求 (body + 可选 origin 原话).

# MODEL
project (name) -- ask (id=ULID)
- project 自动 upsert; ask 用 --after 串单链, 防 fork (409).
- 中间删自动接续: A->B->C 删 B => A->C.
- project rm 级联删全部 ask.

# I/O
- 输出: stdout 单行 JSON; DELETE 空 (204). 错误: stderr \`jjask: <msg>\` + 非零 exit.
- <body> / --origin / --body 全是位置/flag 参数, 不读 stdin.
- 限长 (chars): body 1..${MAX_BODY_LEN}, origin 0..${MAX_BODY_LEN}, project 1..${MAX_PROJECT_NAME_LEN}.

# COMMANDS

jjask --help | --version | self-update | uninstall

jjask new <project> <body> [--origin <body>] [--after <prev_ask_id>]
  -> {id, project_id, body, origin, prev_id, created_at, updated_at}
  err: 400 prev 跨项目/不存在 | 409 prev 已有后继
jjask ls <project> [--limit N]   (default ${ASK_LIMIT_DEFAULT}, max ${ASK_LIMIT_MAX}, by updated_at DESC)
  -> [{...ask}]
  err: 404
jjask show <id>
  -> {...ask}
  err: 404
jjask set <id> --body <body>     (origin 一经创建不可改)
  -> {...ask}
  err: 400 | 404
jjask rm <id>
  err: 404 | 409
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

  // jjask: `<verb> ...` → `ask.<verb>`. jjplan: `<noun> <verb> ...`.
  if (ENTRY_NAME === 'jjask') {
    const [verb, ...rest] = argv;
    const handler = commands[`ask.${verb}`];
    if (!handler) {
      die(`unknown command '${verb}'; usage: ${USAGE.help}`);
    }
    await handler(rest);
    return;
  }

  const [noun, verb, ...rest] = argv;
  if (noun === 'ask') {
    die(`'ask' is a jjask command; run 'jjask ${verb ?? '--help'}' instead`);
  }
  const handler = commands[`${noun}.${verb}`];
  if (!handler) {
    die(`unknown command '${[noun, verb].filter(Boolean).join(' ')}'; usage: ${USAGE.help}`);
  }
  await handler(rest);
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
