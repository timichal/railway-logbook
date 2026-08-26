"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js` — see that file for what it does and, mostly, what it
 * deliberately does not.
 *
 * Renders nothing; it is mounted in the root layout because the worker's scope is
 * the whole origin, and because Chrome's install prompt is only offered to a page
 * that already controls one.
 *
 * **Production only.** In development the worker would sit in front of Turbopack's
 * asset URLs, which change on every edit — and a worker installed once on
 * `localhost` outlives the session that installed it, so dev also actively
 * unregisters whatever a previous production build left behind on the same origin.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) registration.unregister();
      });
      return;
    }

    navigator.serviceWorker
      // `updateViaCache: "none"` keeps the browser from serving sw.js out of its own
      // HTTP cache, which is what pins a site to a stale worker for up to a day.
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error) => {
        // A failed registration costs the install prompt and the asset cache, and
        // nothing else — the app runs unchanged without it.
        console.error("Service worker registration failed:", error);
      });
  }, []);

  return null;
}
