/** @type {import('next').NextConfig} */
const REMOTE = process.env.JJ_PLAN_REMOTE || "https://jj-plan.yigegongjiang.com";

const isProd = process.env.NODE_ENV === "production";

// Production (`next build`) emits a static export consumed by the Worker
// [assets] binding — same-origin in prod, no proxy needed.
// Dev (`next dev`) instead exposes a reverse proxy so `api.ts` keeps using
// relative paths while talking to the deployed worker. Splitting the two
// branches keeps `rewrites` off the prod config entirely (next warns about
// it as long as the field is present, even when it returns []).
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
