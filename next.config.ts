import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone sideband is a long-lived Node WebSocket. Keeping `ws` external
  // prevents the production bundler from replacing its native masking path.
  serverExternalPackages: ["ws"],
};

export default nextConfig;
