"use client";

import { useCallback, useEffect, useState } from "react";
import { getPublicMapSettings, setPublicMapEnabled } from "@/lib/publicMapActions";
import { useRegionId } from "@/lib/regionContext";
import { btn, iconBtn } from "@/lib/ui/buttonStyles";

interface ShareMapDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for publishing a read-only copy of the user's map at /shared/<token>.
 *
 * The settings are fetched when the dialog opens rather than with the page: the
 * token is minted on that first read, so a user who never opens this dialog
 * never gets one. The link appears only while sharing is on — the same one every
 * time, since the token outlives the switch.
 *
 * The link carries `?view=<region>` — whichever region the sharer is looking at
 * right now. A shared map is shared as a *view* of something, and without it the
 * visitor lands on whatever region their own cookie happens to hold: someone
 * sending their Japan map to a friend who last browsed Europe would have them
 * open an empty Europe map. The token is unchanged by this; only the query is.
 */
export default function ShareMapDialog({ isOpen, onClose }: ShareMapDialogProps) {
  const regionId = useRegionId();
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The token only ever arrives from the effect below, so this is a browser-only
  // value in practice; the explicit check keeps it safe under SSR regardless.
  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/shared/${token}?view=${regionId}`
      : "";

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    getPublicMapSettings()
      .then((settings) => {
        if (cancelled) return;
        setEnabled(settings.enabled);
        setToken(settings.token);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your sharing settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Reset the transient "Copied!" state whenever the dialog is reopened
  useEffect(() => {
    if (!isOpen) setCopied(false);
  }, [isOpen]);

  // Escape closes, matching the admin note popup
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const handleToggle = useCallback(async (next: boolean) => {
    setSaving(true);
    setError(null);
    // Optimistic: the switch is the whole point of the dialog, and a round trip
    // of lag on it reads as a broken control.
    setEnabled(next);
    try {
      const settings = await setPublicMapEnabled(next);
      setEnabled(settings.enabled);
      setToken(settings.token);
    } catch {
      setEnabled(!next);
      setError("Could not save the setting. Please try again.");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the link and copy it manually.");
    }
  }, [shareUrl]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Share your map</h3>
            <p className="text-sm text-gray-600 mt-1">
              Publish a read-only version of your map for anyone to view.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${iconBtn("sm")} ml-4`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center text-sm text-gray-500 py-4">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
            Loading sharing settings…
          </div>
        ) : (
          <>
            <label className="flex items-center justify-between gap-4 py-3 border-t border-b border-gray-200">
              <span className="text-sm font-medium text-gray-900">Enable public map display</span>
              <span className="relative inline-flex flex-shrink-0">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={saving || !token}
                  onChange={(event) => handleToggle(event.target.checked)}
                  className="peer sr-only"
                />
                <span className="w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-600 peer-disabled:opacity-50 transition-colors"></span>
                <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5"></span>
              </span>
            </label>

            {/* The link only exists as an offer while sharing is on — a dead one
                on screen just invites someone to send it. It is the same link
                each time it comes back, the token outliving the switch. */}
            {enabled ? (
              <div className="mt-4">
                <div className="text-xs font-medium text-gray-700 mb-1">Public link</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-md text-sm text-black bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!shareUrl}
                    className={`${btn("primary", "md")} whitespace-nowrap`}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Anyone with this link can see your map. Turn the switch off to disable the link.
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-500 mt-3">
                Your map is private. Turn the switch on to publish it and get a link to share.
              </p>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>
    </div>
  );
}
