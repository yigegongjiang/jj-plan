import { readdir, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";

import pkg from "./package.json" with { type: "json" };

const VERSION = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
const REPO = pkg.repository;
const ENTRIES = ["jj-plan", "jj-ask"] as const;
const ARCHES = ["x64", "arm64"] as const;

async function cleanLeftovers(): Promise<void> {
  const entries = await readdir(".");
  await Promise.all(
    entries
      .filter((n) => n.endsWith(".bun-build"))
      .map((n) => unlink(n).catch(() => {})),
  );
}

try {
  for (const entry of ENTRIES) {
    for (const arch of ARCHES) {
      const outfile = `./dist/${entry}-macos-${arch}`;
      const result = await Bun.build({
        entrypoints: [`./src/${entry}.ts`],
        compile: { outfile, target: `bun-darwin-${arch}` },
        define: {
          JJ_VERSION: JSON.stringify(VERSION),
          JJ_REPO: JSON.stringify(REPO),
        },
        minify: true,
      });
      if (!result.success) {
        for (const log of result.logs) console.error(log);
        throw new Error(`build failed for ${entry}-${arch}`);
      }
      console.log(`built: ${outfile}`);
    }
  }
} finally {
  await cleanLeftovers();
}
