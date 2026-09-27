"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/authActions";
import * as localStore from "@/lib/localStorage";
import { migrateLocalJourneys } from "@/lib/migrationActions";
import { describeJourneyMigration } from "@/lib/migrationMessage";
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

  /**
   * Ask what to do with the journeys stored locally, and do it. Resolves once the
   * chosen action has finished; the dialog has no way out but its three buttons,
   * so it always does.
   */
  async function settleLocalJourneys(journeyCount: number) {
    const plural = journeyCount !== 1 ? "s" : "";
    const choice = await new Promise<"merge" | "keep" | "delete">((resolve) =>
      showConfirm({
        title: "Merge Local Journeys?",
        message: `You have ${journeyCount} journey${plural} stored locally. Would you like to merge them with your account?\n\nDuplicates will be skipped automatically.\n\nIf you choose "Keep Local", these journeys will remain in your browser but won't be visible until you log out.`,
        confirmLabel: `Merge ${journeyCount} Journey${plural}`,
        cancelLabel: "Keep Local",
        thirdLabel: "Delete Local",
        variant: "info",
        onConfirm: () => resolve("merge"),
        onCancel: () => resolve("keep"),
        onThird: () => resolve("delete"),
      }),
    );

    if (choice === "keep") {
      // Journeys stay in localStorage, invisible until logout.
      showSuccess("Signed in. Your local journeys remain in browser storage.");
    } else if (choice === "delete") {
      localStore.clearAll();
      showSuccess("Signed in. Local journeys have been deleted.");
    } else {
      try {
        const { journeys, parts } = localStore.exportJourneysData();
        const result = await migrateLocalJourneys(journeys, parts);

        // Clear localStorage after successful migration
        localStore.clearAll();

        showSuccess(describeJourneyMigration(result));
      } catch (err) {
        console.error("Error migrating journeys:", err);
        showSuccess(
          "Signed in, but journey migration failed. Your local journeys are still saved.",
        );
      }
    }
  }

  async function handleSubmit(formData: FormData) {
    setError("");
    setLoading(true);

    try {
      const result = await login(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      const journeyCount = localStore.getJourneyCount();
      if (journeyCount > 0) {
        await settleLocalJourneys(journeyCount);
      }

      // Only now close the sheet and pick up the session. Until then the page is
      // still the signed-out one, and a journey logged locally while a merge is
      // in flight would be wiped by its `clearAll()` without ever being sent.
      onSuccess();
      router.refresh();
    } catch (err) {
      // Only an unexpected failure lands here; its message is not for the user.
      console.error("Error signing in:", err);
      setError("Something went wrong. Please try again.");
    } finally {
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
