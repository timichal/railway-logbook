"use client";

import { useState } from "react";
import { signOutOtherDevices } from "@/lib/authActions";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";
import { FIELD, FIELD_LABEL, FORM_ERROR } from "@/lib/ui/inputStyles";

interface SignOutOtherDevicesFormProps {
  /** Back to the menu once it is done. */
  onDone: () => void;
}

/**
 * Signing out every other browser and app login — for a lost phone or a shared
 * computer left signed in. This browser stays signed in (`signOutOtherDevices`
 * re-issues its cookie). Behind the password, so a stolen session can't use it
 * to shut the owner out; typing it is the confirmation.
 */
export default function SignOutOtherDevicesForm({ onDone }: SignOutOtherDevicesFormProps) {
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const { showSuccess } = useToast();

  async function handleSubmit(formData: FormData) {
    setError("");
    setLoading(true);

    try {
      const result = await signOutOtherDevices(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      showSuccess("Signed out of every other device.");
      onDone();
    } catch (err) {
      // Only an unexpected failure lands here; its message is not for the user.
      console.error("Error signing out other devices:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" action={handleSubmit}>
      <p className="text-sm text-gray-700">
        Every other browser and app signed in to your account is signed out and has to sign in
        again. This one stays signed in. Your journeys and trips are not affected.
      </p>

      <div>
        <label htmlFor="sign-out-others-password" className={FIELD_LABEL}>
          Password
        </label>
        <input
          id="sign-out-others-password"
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
        {loading ? "Signing out…" : "Sign out other devices"}
      </button>
    </form>
  );
}
