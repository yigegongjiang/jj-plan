import path from 'node:path';
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(__dirname, 'migrations'),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Test-only bindings. JJPLAN_TOKEN is the bearer token tests use;
          // TEST_MIGRATIONS is consumed by ./test/setup.ts to seed schema.
          bindings: {
            JJPLAN_TOKEN: 'test-token',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
