// jjplan binary: project/spec/task workflow.
import {
  api,
  die,
  dieUsage,
  print,
  readStdin,
  resolveVersion,
  runInstaller,
  parseSetFlags,
  validateBody,
  validateProject,
  validateTitle,
  requireId,
  requireNoArgs,
  SPEC_STATUSES,
  TASK_STATUSES,
  MAX_TITLE_LEN,
  MAX_BODY_LEN,
  MAX_PROJECT_NAME_LEN,
} from './shared';

const ENTRY = 'jjplan';
const VERSION = resolveVersion();

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

function fail(msg: string): never {
  die(ENTRY, msg);
}
function failUsage(k: UsageKey, reason: string): never {
  dieUsage(ENTRY, USAGE[k], reason);
}

function parseSpecNewArgs(args: string[]): { project: string; title: string; prevId?: string } {
  let project: string | undefined;
  let title: string | undefined;
  let prevId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--after') {
      if (prevId !== undefined) failUsage('spec.new', 'duplicate --after');
      prevId = args[++i];
      if (typeof prevId !== 'string' || prevId.length === 0 || prevId.startsWith('--')) {
        failUsage('spec.new', 'missing <prev_spec_id> after --after');
      }
    } else if (arg.startsWith('--')) {
      failUsage('spec.new', `unknown option ${arg}`);
    } else if (project === undefined) {
      project = arg;
    } else if (title === undefined) {
      title = arg;
    } else {
      failUsage('spec.new', `unexpected argument ${arg}`);
    }
  }

  if (project === undefined) failUsage('spec.new', 'missing <project>');
  if (title === undefined) failUsage('spec.new', 'missing <title>');
  validateProject(ENTRY, project);
  validateTitle(ENTRY, title);
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
      if (prevId !== undefined) failUsage('task.new', 'duplicate --after');
      prevId = args[++i];
      if (typeof prevId !== 'string' || prevId.length === 0 || prevId.startsWith('--')) {
        failUsage('task.new', 'missing <prev_task_id> after --after');
      }
    } else if (arg.startsWith('--')) {
      failUsage('task.new', `unknown option ${arg}`);
    } else if (specId === undefined) {
      specId = arg;
    } else if (title === undefined) {
      title = arg;
    } else {
      failUsage('task.new', `unexpected argument ${arg}`);
    }
  }

  if (specId === undefined) failUsage('task.new', 'missing <spec_id>');
  if (title === undefined) failUsage('task.new', 'missing <title>');
  validateTitle(ENTRY, title);
  return prevId ? { specId, title, prevId } : { specId, title };
}

type Handler = (rest: string[]) => Promise<void>;

const commands: Record<string, Handler> = {
  async 'project.ls'(rest) {
    requireNoArgs(ENTRY, rest, USAGE['project.ls']);
    print(await api(ENTRY, 'GET', '/projects'));
  },

  async 'project.rm'([name, ...rest]) {
    if (!name || name.startsWith('--')) failUsage('project.rm', 'missing <name>');
    if (rest.length > 0) failUsage('project.rm', `unexpected argument ${rest[0]}`);
    await api(ENTRY, 'DELETE', `/projects/${encodeURIComponent(name)}`);
  },

  async 'spec.new'(args) {
    const { project, title, prevId } = parseSpecNewArgs(args);
    const body = readStdin();
    validateBody(ENTRY, body);
    const payload: { title: string; body: string; prev_id?: string } = { title, body };
    if (prevId) payload.prev_id = prevId;
    print(await api(ENTRY, 'POST', `/projects/${encodeURIComponent(project)}/specs`, payload));
  },

  async 'spec.ls'([project, ...rest]) {
    if (!project || project.startsWith('--')) failUsage('spec.ls', 'missing <project>');
    if (rest.length > 0) failUsage('spec.ls', `unexpected argument ${rest[0]}`);
    validateProject(ENTRY, project);
    print(await api(ENTRY, 'GET', `/projects/${encodeURIComponent(project)}/specs`));
  },

  async 'spec.show'([id, ...rest]) {
    const checked = requireId(ENTRY, id, rest, USAGE['spec.show']);
    print(await api(ENTRY, 'GET', `/specs/${encodeURIComponent(checked)}`));
  },

  async 'spec.set'([id, ...rest]) {
    const checked = requireId(ENTRY, id, [], USAGE['spec.set']);
    const flags = parseSetFlags(ENTRY, rest, SPEC_STATUSES, USAGE['spec.set']);
    print(await api(ENTRY, 'PATCH', `/specs/${encodeURIComponent(checked)}`, flags));
  },

  async 'spec.rm'([id, ...rest]) {
    const checked = requireId(ENTRY, id, rest, USAGE['spec.rm']);
    await api(ENTRY, 'DELETE', `/specs/${encodeURIComponent(checked)}`);
  },

  async 'task.new'(args) {
    const { specId, title, prevId } = parseTaskNewArgs(args);
    const body = readStdin();
    validateBody(ENTRY, body);
    const payload: { title: string; body: string; prev_id?: string } = { title, body };
    if (prevId) payload.prev_id = prevId;
    print(await api(ENTRY, 'POST', `/specs/${encodeURIComponent(specId)}/tasks`, payload));
  },

  async 'task.ls'([specId, ...rest]) {
    if (!specId || specId.startsWith('--')) failUsage('task.ls', 'missing <spec_id>');
    if (rest.length > 0) failUsage('task.ls', `unexpected argument ${rest[0]}`);
    const spec = await api(ENTRY, 'GET', `/specs/${encodeURIComponent(specId)}`);
    const tasks = (spec as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) fail('unexpected response: tasks missing');
    print(tasks);
  },

  async 'task.set'([id, ...rest]) {
    const checked = requireId(ENTRY, id, [], USAGE['task.set']);
    const flags = parseSetFlags(ENTRY, rest, TASK_STATUSES, USAGE['task.set']);
    print(await api(ENTRY, 'PATCH', `/tasks/${encodeURIComponent(checked)}`, flags));
  },

  async 'task.rm'([id, ...rest]) {
    const checked = requireId(ENTRY, id, rest, USAGE['task.rm']);
    await api(ENTRY, 'DELETE', `/tasks/${encodeURIComponent(checked)}`);
  },
};

function printHelp(): void {
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
jjplan self-update | uninstall          仅在用户明确要求时执行 (同时影响 jjask)

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '-h' || argv[0] === '--help') {
    if (argv.length > 1) failUsage('help', `unexpected argument ${argv[1]}`);
    printHelp();
    return;
  }
  if (argv[0] === '-v' || argv[0] === '--version') {
    if (argv.length > 1) failUsage('version', `unexpected argument ${argv[1]}`);
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv[0] === 'self-update') {
    if (argv.length > 1) failUsage('self-update', `unexpected argument ${argv[1]}`);
    runInstaller(ENTRY, []);
    return;
  }
  if (argv[0] === 'uninstall') {
    if (argv.length > 1) failUsage('uninstall', `unexpected argument ${argv[1]}`);
    runInstaller(ENTRY, ['--uninstall']);
    return;
  }

  const [noun, verb, ...rest] = argv;
  if (noun === 'ask') {
    fail(`'ask' is a jjask command; run 'jjask ${verb ?? '--help'}' instead`);
  }
  const handler = commands[`${noun}.${verb}`];
  if (!handler) {
    fail(`unknown command '${[noun, verb].filter(Boolean).join(' ')}'; usage: ${USAGE.help}`);
  }
  await handler(rest);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
