/** @type {import('next').NextConfig} */
// Static export consumed by the Worker [assets] binding — served same-origin,
// API calls use relative paths. No dev proxy, no host config.
const config = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default config;
