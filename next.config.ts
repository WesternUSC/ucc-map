import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/", destination: "/ucc-map-2d", permanent: false }];
  },
};
export default nextConfig;
