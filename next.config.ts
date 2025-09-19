import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  // Make HTML source code readable for debugging
  compiler: {
    removeConsole: false, // Keep console.logs for debugging
  },
  // Disable HTML compression and minification
  compress: false,
  poweredByHeader: false,
  // Configure output to be more readable
  output: 'standalone',
};

export default nextConfig;
