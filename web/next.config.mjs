/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

// Dev-only reverse-proxy target. Production (`next build`) is a static export
// served same-origin by the Worker — no host baked in. `next dev` proxies to a
// local wrangler dev by default; set JJ_PLAN_REMOTE to point elsewhere.
const REMOTE = process.env.JJ_PLAN_REMOTE || "http://127.0.0.1:8787";

const config = isProd
  ? {
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
      reactStrictMode: true,
    }
  : {
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

export default config;
