"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/authActions";
import * as localStore from "@/lib/localStorage";
import { migrateLocalJourneys } from "@/lib/migrationActions";
import { useToast } from "@/lib/toast";
import { btn, LINK_BTN } from "@/lib/ui/buttonStyles";
import { FIELD, FIELD_LABEL, FORM_ERROR } from "@/lib/ui/inputStyles";

interface LoginFormProps {
  /** Always supplied: the menu sheet is the only place either form is rendered. */
  onSuccess: () => void;
  /** Swaps the sheet to the register view — the only route between the two forms,
      since the menu's footer is hidden while a form is open. */
  onSwitchToRegister?: () => void;
}

export default function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { showSuccess, showConfirm } = useToast();

  async function handleSubmit(formData: FormData) {
    setError("");
    setLoading(true);

    try {
      await login(formData);

      // Check if there are localStorage journeys
      const journeyCount = localStore.getJourneyCount();

      if (journeyCount > 0) {
        // Show confirmation dialog for merging journeys
        showConfirm({
          title: "Merge Local Journeys?",
          message: `You have ${journeyCount} journey${journeyCount !== 1 ? "s" : ""} stored locally. Would you like to merge them with your account?\n\nDuplicates will be skipped automatically.\n\nIf you choose "Keep Local", these journeys will remain in your browser but won't be visible until you log out.`,
          confirmLabel: `Merge ${journeyCount} Journey${journeyCount !== 1 ? "s" : ""}`,
          cancelLabel: "Keep Local",
          thirdLabel: "Delete Local",
          variant: "info",
          onConfirm: async () => {
            try {
              const { journeys, parts } = localStore.exportJourneysData();
              const result = await migrateLocalJourneys(journeys, parts);

              // Clear localStorage after successful migration
              localStore.clearAll();

              if (result.journeysMigrated > 0) {
                showSuccess(
                  `${result.journeysMigrated} journey${result.journeysMigrated !== 1 ? "s" : ""} and ${result.partsMigrated} route${result.partsMigrated !== 1 ? "s" : ""} merged successfully!`,
                );
              } else {
                showSuccess("All journeys were duplicates, none merged.");
              }

              // Refresh to show merged data
              router.refresh();
            } catch (err) {
              console.error("Error migrating journeys:", err);
              showSuccess(
                "Signed in, but journey migration failed. Your local journeys are still saved.",
              );
            }
          },
          onCancel: () => {
            // User chose to keep local - journeys stay in localStorage but invisible
            showSuccess("Signed in. Your local journeys remain in browser storage.");
            router.refresh();
          },
          onThird: () => {
            // User chose to delete local journeys
            localStore.clearAll();
            showSuccess("Signed in. Local journeys have been deleted.");
            router.refresh();
          },
        });
      } else {
        // No local journeys to ask about — close the sheet and pick up the session.
        onSuccess();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <form className="space-y-4" action={handleSubmit}>
        <div>
          <label htmlFor="email" className={FIELD_LABEL}>
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={FIELD}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className={FIELD_LABEL}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={FIELD}
            placeholder="Your password"
          />
        </div>

        {error && (
          <p className={FORM_ERROR} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className={`${btn("primary", "lg")} w-full`}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {onSwitchToRegister && (
        <p className="text-center text-sm text-gray-600">
          No account yet?{" "}
          <button type="button" onClick={onSwitchToRegister} className={LINK_BTN}>
            Create one
          </button>
        </p>
      )}
    </div>
  );
}
