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
  'task.new': 'jjplan task new <spec_id> <title>',
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

  async 'task.new'([specId, title, ...rest]) {
    if (!specId || specId.startsWith('--')) dieUsage('task.new', 'missing <spec_id>');
    if (!title || title.startsWith('--')) dieUsage('task.new', 'missing <title>');
    if (rest.length > 0) dieUsage('task.new', `unexpected argument ${rest[0]}`);
    validateTitle(title);
    const body = readStdin();
    validateBody(body);
    print(
      await api('POST', `/specs/${encodeURIComponent(specId)}/tasks`, {
        title,
        body,
      }),
    );
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

AI-facing CLI for the jjplan Spec/Task system.
Success prints compact JSON to stdout unless noted. Errors are one-line stderr plus non-zero exit.
Bodies for new specs/tasks are read from stdin; no stdin means empty body.
Limits: title 1..${MAX_TITLE_LEN} chars, body 0..${MAX_BODY_LEN} chars, project 1..${MAX_PROJECT_NAME_LEN} chars.

Project scoping:
  spec new / spec ls take an explicit <project> positional argument supplied
  by the caller (e.g. the AI passes its working-directory basename). The
  project is upserted on first spec.new. Other commands address specs and
  tasks by id, independent of any project.

Commands:
  jjplan help | jjplan --help -> help text
  jjplan --version -> version
  jjplan project ls -> project[] JSON (with specs+tasks nested)
  ${USAGE['project.rm']} -> empty
  ${USAGE['spec.new']} -> spec JSON (project upserted on first sight)
  ${USAGE['spec.ls']} -> spec[] JSON for that project
  jjplan spec show <id> -> spec JSON
  ${USAGE['spec.set']} -> spec JSON
  jjplan spec rm <id> -> empty
  ${USAGE['task.new']} -> task JSON
  jjplan task ls <spec_id> -> task[] JSON
  ${USAGE['task.set']} -> task JSON
  jjplan task rm <id> -> empty
  jjplan self-update -> install latest release binary
  jjplan uninstall -> remove installed binary

Rules:
  Use ids from JSON responses.
  Unknown commands, unknown options, extra args, and invalid statuses are errors.
  spec.status: ${SPEC_STATUSES.join('|')}
  task.status: ${TASK_STATUSES.join('|')}

Config: ${CONFIG_PATH}
        {"endpoint":"https://jjplan.<acct>.workers.dev","token":"<your password>"}
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
