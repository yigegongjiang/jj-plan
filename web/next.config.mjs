import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

// Dev-only reverse-proxy target. Production (`next build`) is a static export
// served same-origin by the Worker, so no host is baked in. For `next dev` we
// reuse the CLI's own config endpoint (single source of truth — whoever deploys
// points their own config.json there), with an env override and a local
// wrangler-dev fallback. No production domain is hardcoded anywhere.
function devRemote() {
  if (process.env.JJ_PLAN_REMOTE) return process.env.JJ_PLAN_REMOTE;
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const candidates = [
    join(configHome, "jj-plan", "config.json"),
    join(configHome, "jjplan", "config.json"),
    join(homedir(), ".jjplan", "config.json"),
  ];
  for (const p of candidates) {
    try {
      const { endpoint } = JSON.parse(readFileSync(p, "utf8"));
      if (endpoint) return endpoint;
    } catch {
      // next candidate
    }
  }
  return "http://127.0.0.1:8787"; // wrangler dev default
}

const config = isProd
  ? {
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
      reactStrictMode: true,
    }
  : (() => {
      const REMOTE = devRemote();
      return {
        trailingSlash: true,
        images: { unoptimized: true },
        reactStrictMode: true,
        async rewrites() {
          return [
            { source: "/projects", destination: `${REMOTE}/projects` },
            { source: "/projects/:p*", destination: `${REMOTE}/projects/:p*` },
            { source: "/specs/:p*", destination: `${REMOTE}/specs/:p*` },
            { source: "/tasks/:p*", destination: `${REMOTE}/tasks/:p*` },
            { source: "/asks", destination: `${REMOTE}/asks` },
            { source: "/asks/:p*", destination: `${REMOTE}/asks/:p*` },
          ];
        },
      };
    })();

export default config;
