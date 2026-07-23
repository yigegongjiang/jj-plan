// jj-ask binary: Q&A (human ask) logging.
import {
  api,
  die,
  dieUsage,
  print,
  resolveVersion,
  runInstaller,
  validateProject,
  requireId,
  MAX_BODY_LEN,
  MAX_PROJECT_NAME_LEN,
  ASK_LIMIT_DEFAULT,
  ASK_LIMIT_MAX,
} from './shared';

const ENTRY = 'jj-ask';
const VERSION = resolveVersion();

const USAGE = {
  help: 'jj-ask --help',
  version: 'jj-ask --version',
  update: 'jj-ask update | upgrade',
  uninstall: 'jj-ask uninstall',
  'ask.new': 'jj-ask new <project> <body>',
  'ask.ls': `jj-ask ls <project> [--limit N]   (default ${ASK_LIMIT_DEFAULT}, max ${ASK_LIMIT_MAX})`,
  'ask.show': 'jj-ask show <id>',
  'ask.set': 'jj-ask set <id> --body <body>',
  'ask.rm': 'jj-ask rm <id>',
} as const;

type UsageKey = keyof typeof USAGE;

function fail(msg: string): never {
  die(ENTRY, msg);
}
function failUsage(k: UsageKey, reason: string): never {
  dieUsage(ENTRY, USAGE[k], reason);
}

function parseAskNewArgs(args: string[]): { project: string; body: string } {
  let project: string | undefined;
  let body: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      failUsage('ask.new', `unknown option ${arg}`);
    } else if (project === undefined) {
      project = arg;
    } else if (body === undefined) {
      body = arg;
    } else {
      failUsage('ask.new', `unexpected argument ${arg}`);
    }
  }

  if (project === undefined) failUsage('ask.new', 'missing <project>');
  if (body === undefined) failUsage('ask.new', 'missing <body>');
  validateProject(ENTRY, project);
  if (body.length === 0 || body.length > MAX_BODY_LEN) {
    failUsage('ask.new', `body length must be 1..${MAX_BODY_LEN}`);
  }
  return { project, body };
}

function parseAskLsArgs(args: string[]): { project: string; limit?: number } {
  let project: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--limit') {
      if (limit !== undefined) failUsage('ask.ls', 'duplicate --limit');
      const v = args[++i];
      if (typeof v !== 'string' || v.startsWith('--')) {
        failUsage('ask.ls', 'missing <N> after --limit');
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > ASK_LIMIT_MAX) {
        failUsage('ask.ls', `--limit must be integer in 1..${ASK_LIMIT_MAX}`);
      }
      limit = n;
    } else if (arg.startsWith('--')) {
      failUsage('ask.ls', `unknown option ${arg}`);
    } else if (project === undefined) {
      project = arg;
    } else {
      failUsage('ask.ls', `unexpected argument ${arg}`);
    }
  }

  if (project === undefined) failUsage('ask.ls', 'missing <project>');
  validateProject(ENTRY, project);
  return limit !== undefined ? { project, limit } : { project };
}

function parseAskSetArgs(args: string[]): { id: string; body: string } {
  let id: string | undefined;
  let body: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--body') {
      if (body !== undefined) failUsage('ask.set', 'duplicate --body');
      const v = args[++i];
      if (typeof v !== 'string') failUsage('ask.set', 'missing <body> after --body');
      body = v;
    } else if (arg.startsWith('--')) {
      failUsage('ask.set', `unknown option ${arg}`);
    } else if (id === undefined) {
      id = arg;
    } else {
      failUsage('ask.set', `unexpected argument ${arg}`);
    }
  }

  if (id === undefined) failUsage('ask.set', 'missing <id>');
  if (body === undefined) failUsage('ask.set', 'missing --body');
  if (body.length === 0 || body.length > MAX_BODY_LEN) {
    failUsage('ask.set', `body length must be 1..${MAX_BODY_LEN}`);
  }
  return { id, body };
}

type Handler = (rest: string[]) => Promise<void>;

const commands: Record<string, Handler> = {
  async 'ask.new'(args) {
    const { project, body } = parseAskNewArgs(args);
    print(await api(ENTRY, 'POST', `/projects/${encodeURIComponent(project)}/asks`, { body }));
  },

  async 'ask.ls'(args) {
    const { project, limit } = parseAskLsArgs(args);
    const q = limit !== undefined ? `?limit=${limit}` : '';
    print(await api(ENTRY, 'GET', `/projects/${encodeURIComponent(project)}/asks${q}`));
  },

  async 'ask.show'([id, ...rest]) {
    const checked = requireId(ENTRY, id, rest, USAGE['ask.show']);
    print(await api(ENTRY, 'GET', `/asks/${encodeURIComponent(checked)}`));
  },

  async 'ask.set'(args) {
    const { id, body } = parseAskSetArgs(args);
    print(await api(ENTRY, 'PATCH', `/asks/${encodeURIComponent(id)}`, { body }));
  },

  async 'ask.rm'([id, ...rest]) {
    const checked = requireId(ENTRY, id, rest, USAGE['ask.rm']);
    await api(ENTRY, 'DELETE', `/asks/${encodeURIComponent(checked)}`);
  },
};

function printHelp(): void {
  process.stdout.write(
    `jj-ask ${VERSION}

# TLDR
jj-ask: 落盘人类抛给 AI 的请求 (Q&A 记录). 两层模型 project -> ask, id=ULID. <project>=cwd basename.
每条 ask 都是独立记录, 不串链.

  jj-ask new <project> <body>
    # body=用户原话原文照搬.

输出: stdout 单行 JSON. body 不读 stdin (位置参数). 查询/修改/删除见 jj-ask --help.

# PURPOSE
落盘人类抛给 AI 的请求.

# MODEL
project (name) -- ask (id=ULID)
- project 自动 upsert.
- ask 之间相互独立, 无 prev/next 关系.
- project rm 级联删全部 ask.

# I/O
- 输出: stdout 单行 JSON; DELETE 空 (204). 错误: stderr \`jj-ask: <msg>\` + 非零 exit.
- <body> / --body 是位置/flag 参数, 不读 stdin.
- 限长 (chars): body 1..${MAX_BODY_LEN}, project 1..${MAX_PROJECT_NAME_LEN}.

# COMMANDS

jj-ask --help | --version
jj-ask update | upgrade | uninstall       仅在用户明确要求时执行 (同时影响 jj-plan; update/upgrade 等价)

jj-ask new <project> <body>
  -> {id, project_id, body, created_at, updated_at}
jj-ask ls <project> [--limit N]   (default ${ASK_LIMIT_DEFAULT}, max ${ASK_LIMIT_MAX}, by updated_at DESC)
  -> [{...ask}]
  err: 404
jj-ask show <id>
  -> {...ask}
  err: 404
jj-ask set <id> --body <body>
  -> {...ask}
  err: 400 | 404
jj-ask rm <id>
  err: 404
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
  if (argv[0] === 'update' || argv[0] === 'upgrade') {
    if (argv.length > 1) failUsage('update', `unexpected argument ${argv[1]}`);
    runInstaller(ENTRY, []);
    return;
  }
  if (argv[0] === 'uninstall') {
    if (argv.length > 1) failUsage('uninstall', `unexpected argument ${argv[1]}`);
    runInstaller(ENTRY, ['--uninstall']);
    return;
  }

  const [verb, ...rest] = argv;
  const handler = commands[`ask.${verb}`];
  if (!handler) {
    fail(`unknown command '${verb}'; usage: ${USAGE.help}`);
  }
  await handler(rest);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
