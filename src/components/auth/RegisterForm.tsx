"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { register } from "@/lib/authActions";
import * as localStore from "@/lib/localStorage";
import { migrateLocalJourneys } from "@/lib/migrationActions";
import { useToast } from "@/lib/toast";
import { btn, LINK_BTN } from "@/lib/ui/buttonStyles";
import { FIELD, FIELD_HINT, FIELD_LABEL, FORM_ERROR } from "@/lib/ui/inputStyles";

interface RegisterFormProps {
  /** Always supplied: the menu sheet is the only place either form is rendered. */
  onSuccess: () => void;
  /** Swaps the sheet to the sign-in view — the only route between the two forms,
      since the menu's footer is hidden while a form is open. */
  onSwitchToLogin?: () => void;
}

export default function RegisterForm({ onSuccess, onSwitchToLogin }: RegisterFormProps) {
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { showSuccess } = useToast();

  async function handleSubmit(formData: FormData) {
    setError("");
    setLoading(true);

    try {
      // Export localStorage data before registration
      const { journeys, parts } = localStore.exportJourneysData();
      const localPreferences = localStore.exportPreferences();

      // Register with auto-migration
      await register(formData, localPreferences);

      // Migrate journeys if there are any
      if (journeys.length > 0) {
        try {
          const migrationResult = await migrateLocalJourneys(journeys, parts);

          // Clear localStorage after successful migration
          localStore.clearAll();

          if (migrationResult.journeysMigrated > 0) {
            showSuccess(
              `Account created! ${migrationResult.journeysMigrated} journey${migrationResult.journeysMigrated !== 1 ? "s" : ""} and ${migrationResult.partsMigrated} route${migrationResult.partsMigrated !== 1 ? "s" : ""} migrated successfully.`,
            );
          } else {
            showSuccess("Account created successfully!");
          }
        } catch (migrationErr) {
          console.error("Error migrating journeys:", migrationErr);
          showSuccess(
            "Account created, but journey migration failed. Your local journeys are still saved.",
          );
        }
      } else {
        showSuccess("Account created successfully!");
      }

      // Close the sheet, then pick up the new session.
      onSuccess();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <form className="space-y-4" action={handleSubmit}>
        <div>
          <label htmlFor="name" className={FIELD_LABEL}>
            Display name <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            className={FIELD}
            placeholder="How you want to be greeted"
          />
        </div>

        <div>
          <label htmlFor="register-email" className={FIELD_LABEL}>
            Email address
          </label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={FIELD}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="register-password" className={FIELD_LABEL}>
            Password
          </label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            className={FIELD}
            placeholder="Choose a password"
          />
          <p className={FIELD_HINT}>At least 6 characters.</p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className={FIELD_LABEL}>
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            className={FIELD}
            placeholder="Type it again"
          />
        </div>

        {error && (
          <p className={FORM_ERROR} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className={`${btn("primary", "lg")} w-full`}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      {onSwitchToLogin && (
        <p className="text-center text-sm text-gray-600">
          Already have an account?{" "}
          <button type="button" onClick={onSwitchToLogin} className={LINK_BTN}>
            Sign in
          </button>
        </p>
      )}
    </div>
  );
}
