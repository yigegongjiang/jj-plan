// Shared helpers for jjplan + jjask binaries.
// Flat module, no submodules. Each binary entry imports what it needs.
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

declare const JJ_VERSION: string | undefined;

export const CONFIG_PATH = join(homedir(), '.jjplan', 'config.json');
export const INSTALL_URL =
  'https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh';

export const SPEC_STATUSES = ['active', 'done'] as const;
export const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
export const MAX_TITLE_LEN = 200;
export const MAX_BODY_LEN = 65536;
export const MAX_PROJECT_NAME_LEN = 128;

export const ASK_LIMIT_DEFAULT = 3;
export const ASK_LIMIT_MAX = 100;

export interface Config {
  endpoint: string;
  token: string;
}

export function resolveVersion(): string {
  if (typeof JJ_VERSION === 'string' && JJ_VERSION.length > 0) {
    return JJ_VERSION;
  }
  try {
    const raw = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
    if (raw.length > 0) return raw;
  } catch {
    // Source-tree fallback only. Release builds inject JJ_VERSION.
  }
  return 'dev';
}

// ─── error helpers ────────────────────────────────────────────────────────

export function die(entry: string, message: string): never {
  process.stderr.write(`${entry}: ${message.replace(/\s+/g, ' ').trim()}\n`);
  process.exit(1);
}

export function dieUsage(entry: string, usage: string, reason: string): never {
  die(entry, `${reason}; usage: ${usage}`);
}

// ─── config + HTTP ────────────────────────────────────────────────────────

function loadConfig(entry: string): Config {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    die(entry, `unable to read ${CONFIG_PATH}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    die(entry, `invalid JSON in ${CONFIG_PATH}: ${(e as Error).message}`);
  }
  const cfg = parsed as Partial<Config>;
  if (typeof cfg.endpoint !== 'string' || typeof cfg.token !== 'string') {
    die(entry, `${CONFIG_PATH} must contain {"endpoint":"...","token":"..."}`);
  }
  return { endpoint: cfg.endpoint, token: cfg.token };
}

export async function api(
  entry: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const cfg = loadConfig(entry);
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
    die(entry, `network error: ${(e as Error).message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    die(entry, `HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204 || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    die(entry, `non-JSON response: ${text.slice(0, 200)}`);
  }
}

export function readStdin(): string {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function print(value: unknown): void {
  if (value === null || value === undefined) return;
  process.stdout.write(JSON.stringify(value) + '\n');
}

// ─── flag parsing for `set` commands ──────────────────────────────────────

export interface PatchFlags {
  title?: string;
  body?: string;
  status?: string;
}

export function validateTitle(entry: string, title: string): void {
  if (title.length === 0 || title.length > MAX_TITLE_LEN) {
    die(entry, `title length must be 1..${MAX_TITLE_LEN}`);
  }
}

export function validateBody(entry: string, body: string): void {
  if (body.length > MAX_BODY_LEN) {
    die(entry, `body too long (max ${MAX_BODY_LEN} chars)`);
  }
}

export function validateProject(entry: string, name: string): void {
  if (name.length === 0 || name.length > MAX_PROJECT_NAME_LEN) {
    die(entry, `project name length must be 1..${MAX_PROJECT_NAME_LEN}`);
  }
}

export function parseSetFlags(
  entry: string,
  args: string[],
  allowedStatuses: readonly string[],
  usage: string,
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
    dieUsage(entry, usage, (e as Error).message);
  }

  const flags = result.values as PatchFlags;
  if (Object.keys(flags).length === 0) {
    dieUsage(entry, usage, 'no fields provided');
  }
  if (flags.status !== undefined && !allowedStatuses.includes(flags.status)) {
    dieUsage(entry, usage, `invalid status '${flags.status}'; allowed: ${allowedStatuses.join('|')}`);
  }
  if (flags.title !== undefined) validateTitle(entry, flags.title);
  if (flags.body !== undefined) validateBody(entry, flags.body);
  return flags;
}

export function requireNoArgs(entry: string, args: string[], usage: string): void {
  if (args.length > 0) dieUsage(entry, usage, `unexpected argument ${args[0]}`);
}

export function requireId(
  entry: string,
  id: string | undefined,
  rest: string[],
  usage: string,
): string {
  if (!id || id.startsWith('--')) dieUsage(entry, usage, 'missing <id>');
  if (rest.length > 0) dieUsage(entry, usage, `unexpected argument ${rest[0]}`);
  return id;
}

// ─── installer ────────────────────────────────────────────────────────────

export function runInstaller(entry: string, args: string[]): void {
  const suffix = args.length > 0 ? ` -s -- ${args.join(' ')}` : '';
  try {
    execSync(`curl -fsSL ${INSTALL_URL} | bash${suffix}`, { stdio: 'inherit' });
  } catch {
    die(entry, args.includes('--uninstall') ? 'uninstall failed' : 'self-update failed');
  }
}
