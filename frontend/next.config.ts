import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-host: no external image domains needed
  images: { unoptimized: true },

  // PWA headers: ensure service worker scope covers the whole app
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
