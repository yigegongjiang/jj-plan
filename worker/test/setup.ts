/// <reference types="@cloudflare/vitest-pool-workers" />
import { applyD1Migrations, env } from 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    JJPLAN_TOKEN: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}

// applyD1Migrations is idempotent: only un-applied migrations run. Safe to
// call from a setup file that may execute more than once across worker
// instances. The actual per-test data wipe happens in the test file's
// beforeEach hook, not here.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
