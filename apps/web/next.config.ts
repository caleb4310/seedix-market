import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@seedix/shared"],
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
};

export default nextConfig;
