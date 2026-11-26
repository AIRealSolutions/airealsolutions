import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app is its own project (also when it sits inside the Factory repo as a template).
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
