import type { NextConfig } from "next";

// Security headers applied to every response. HSTS is omitted because Vercel
// already sends it. A full script CSP is omitted because Next's inline
// bootstrap scripts and Google Analytics would require per-request nonces;
// frame-ancestors is the one CSP directive enforced here (clickjacking defense).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
