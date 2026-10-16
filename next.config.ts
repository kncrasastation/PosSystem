import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Product photos are resized in the browser first; the server also caps them at 2 MB.
    serverActions: { bodySizeLimit: "3mb" },
  },
};
export default nextConfig;
