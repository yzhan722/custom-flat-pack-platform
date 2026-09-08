import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and node-postgres uses native networking; both are loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // The engineering kernel is consumed as TypeScript source from the workspace.
  transpilePackages: ["@cfp/core"],
};

export default nextConfig;
