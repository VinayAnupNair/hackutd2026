// next.config.mjs
import { networkInterfaces } from "node:os";

const isDev = process.env.NODE_ENV !== "production";

/** Non-loopback IPv4 addresses, so LAN / VPN clients can load dev assets. */
function lanHosts() {
  const hosts = [];
  try {
    for (const list of Object.values(networkInterfaces() || {})) {
      for (const net of list || []) {
        if (net.family === "IPv4" && !net.internal && net.address) {
          hosts.push(net.address);
        }
      }
    }
  } catch {
    // restricted environments
  }
  return hosts;
}

function csp() {
  return [
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval';",
    "script-src * data: blob: 'unsafe-inline' 'unsafe-eval';",
    "style-src * data: blob: 'unsafe-inline';",
    "img-src * data: blob:;",
    "frame-src * data: blob:;",
    "connect-src * data: blob:;",
    "font-src * data: blob:;",
    "worker-src * blob:;",
    "object-src *;",
    "base-uri *;",
  ].join(" ");
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: csp(),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: isDev ? ["127.0.0.1", ...lanHosts()] : [],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
