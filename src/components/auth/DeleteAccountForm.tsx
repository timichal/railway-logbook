"use client";

import { useState } from "react";
import { deleteAccount } from "@/lib/authActions";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";
import { FIELD, FIELD_LABEL, FORM_ERROR } from "@/lib/ui/inputStyles";

interface DeleteAccountFormProps {
  /** Closes the menu. No refresh: an action that deletes a cookie returns the
      re-rendered (signed-out) page with its result. */
  onDeleted: () => void;
}

/**
 * Deleting the account, behind its password — the one confirmation, since typing
 * it is already a deliberate act and a second "Are you sure?" would only be
 * clicked through. The text says what goes, because nothing comes back.
 *
 * No edit-guard question: the drafts belong to journeys and trips this deletes.
 */
export default function DeleteAccountForm({ onDeleted }: DeleteAccountFormProps) {
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const { showSuccess } = useToast();

  async function handleSubmit(formData: FormData) {
    setError("");
    setLoading(true);

    try {
      const result = await deleteAccount(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      onDeleted();
      showSuccess("Your account has been deleted.");
    } catch (err) {
      // Only an unexpected failure lands here; its message is not for the user.
      console.error("Error deleting account:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" action={handleSubmit}>
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          This permanently deletes your account and everything in it: your journeys, trips and
          logged routes, your country selection, and your shared map link.
        </p>
        <p className="font-medium">It cannot be undone.</p>
      </div>

      <div>
        <label htmlFor="delete-account-password" className={FIELD_LABEL}>
          Password
        </label>
        <input
          id="delete-account-password"
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

      <button type="submit" disabled={loading} className={`${btn("danger", "lg")} w-full`}>
        {loading ? "Deleting…" : "Delete account permanently"}
      </button>
    </form>
  );
}
