import path from "path";
import { securityHeaders } from "./lib/csp";
// Webpack ships with Next and is only used in this config. The web package does not depend on it directly.
// @ts-expect-error webpack types are not part of the app compilation.
import webpack from "webpack";
import type { NextConfig } from "next";

const emptyModule = path.join(__dirname, "stubs/empty-module.js");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@seedix/shared"],
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  webpack: (config) => {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^@x402\//, emptyModule));
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
};

export default nextConfig;
