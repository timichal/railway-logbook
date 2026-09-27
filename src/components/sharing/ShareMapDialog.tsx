"use client";

import { useCallback, useId, useState } from "react";
import ToggleSwitch from "@/components/ui/ToggleSwitch";
import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import { getPublicMapSettings, setPublicMapEnabled } from "@/lib/publicMapActions";
import { useRegionId } from "@/lib/regionContext";
import { btn, iconBtn } from "@/lib/ui/buttonStyles";
import { useModalDialog } from "@/lib/ui/useModalDialog";

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
  // Mounted only while open, so every open starts clean — its own load, no error
  // or "Copied!" left over — and a save that returns after a close lands nowhere.
  return isOpen ? <ShareMapPanel onClose={onClose} /> : null;
}

function ShareMapPanel({ onClose }: { onClose: () => void }) {
  const regionId = useRegionId();
  const dialogRef = useModalDialog(onClose);
  const titleId = useId();
  const settings = useAsyncLoad(() => getPublicMapSettings(), [], "sharing settings");
  const { setData: setSettings } = settings;
  const enabled = settings.data?.enabled ?? false;
  const token = settings.data?.token ?? null;
  const [saving, setSaving] = useState(false);
  // A failed save or copy; a failed load is the hook's
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const error = actionError ?? (settings.error ? "Could not load your sharing settings." : null);

  // The token only ever arrives from the load above, so this is a browser-only
  // value in practice; the explicit check keeps it safe under SSR regardless.
  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/shared/${token}?view=${regionId}`
      : "";

  const handleToggle = useCallback(
    async (next: boolean) => {
      setSaving(true);
      setActionError(null);
      // Optimistic: the switch is the whole point of the dialog, and a round trip
      // of lag on it reads as a broken control.
      setSettings((s) => s && { ...s, enabled: next });
      try {
        setSettings(await setPublicMapEnabled(next));
      } catch {
        setSettings((s) => s && { ...s, enabled: !next });
        setActionError("Could not save the setting. Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [setSettings],
  );

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError("Could not copy — select the link and copy it manually.");
    }
  }, [shareUrl]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-lg p-6 bg-surface text-fg rounded-lg shadow-xl backdrop:bg-[rgb(0_0_0/0.5)]"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 id={titleId} className="text-lg font-semibold text-gray-900">
            Share your map
          </h3>
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

      {settings.loading ? (
        <div className="flex items-center text-sm text-gray-500 py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
          Loading sharing settings…
        </div>
      ) : (
        <>
          <div className="py-2 border-t border-b border-gray-200">
            <ToggleSwitch
              label="Enable public map display"
              checked={enabled}
              disabled={saving || !token}
              onChange={handleToggle}
            />
          </div>

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
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-md text-sm text-fg bg-surface"
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
    </dialog>
  );
}
