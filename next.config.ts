import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // `public/` is served with a long `Cache-Control` in production, and a
        // service worker script pinned in the HTTP cache is a site pinned to an old
        // worker — `updateViaCache: "none"` at registration only covers the browsers
        // that honour it. `Service-Worker-Allowed` lets the worker claim the whole
        // origin rather than just `/`'s siblings, which is the scope it registers with.
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
