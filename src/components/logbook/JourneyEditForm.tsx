"use client";

import { useState } from "react";
import JourneyMetaFields from "@/components/logbook/JourneyMetaFields";
import { actionErrorMessage } from "@/lib/actionResult";
import { type JourneySnapshot, journeyEditsToSave, useJourneyEditDraft } from "@/lib/journeyEdit";
import type { JourneyEdits } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";

interface JourneyEditFormProps {
  /** The id the mobile summary bar scrolls to (see NEW_JOURNEY_FORM_ID). */
  formId: string;
  journeyId: number | string;
  /** Where it can be filed; omitted, the journey has no trip field (local journeys). */
  trips?: { id: number; name: string }[];
  onSave: (id: number | string, edits: JourneyEdits) => Promise<void>;
  onDelete: (id: number | string) => Promise<void>;
  /** Saved, deleted or cancelled, with the draft already dropped. */
  onEnd: (saved: boolean) => void;
}

/**
 * The fields of a saved journey being edited in the Route Logger, with Save and
 * Cancel. The routes are edited above it, as the Route Logger's selection. It
 * reads the draft itself, so typing re-renders only this form.
 */
export default function JourneyEditForm({
  formId,
  journeyId,
  trips,
  onSave,
  onDelete,
  onEnd,
}: JourneyEditFormProps) {
  const { showSuccess, showError, showConfirm } = useToast();
  const { draft, setDraft } = useJourneyEditDraft(journeyId);
  const [isSaving, setIsSaving] = useState(false);
  if (!draft) return null;
  const { base, edit } = draft;
  const update = (patch: Partial<JourneySnapshot>) =>
    setDraft({ ...draft, edit: { ...edit, ...patch } });

  const missingField = !edit.name.trim()
    ? "Give the journey a name"
    : !edit.date
      ? "Pick the journey's date"
      : null;

  // A failure keeps the draft, whatever it was: the journey gone is for its card
  // to find (it drops the draft as it opens), and anything else — a trip deleted
  // meanwhile, a dropped connection — leaves an edit worth retrying or changing
  const run = async (action: () => Promise<void>, success: string, failure: string) => {
    setIsSaving(true);
    try {
      await action();
      showSuccess(success);
      setDraft(null);
      onEnd(true);
    } catch (error) {
      console.error(`${failure}:`, error);
      showError(actionErrorMessage(error, failure));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = () => {
    if (missingField) return;
    // A journey with no routes left is one to delete, not keep
    if (edit.routes.length === 0) {
      showConfirm({
        title: "Delete this journey?",
        message: `“${base.name}” has no routes left. Delete the journey, or keep editing to add some?`,
        confirmLabel: "Delete journey",
        cancelLabel: "Keep editing",
        variant: "danger",
        onConfirm: () =>
          void run(() => onDelete(journeyId), "Journey deleted", "Failed to delete journey"),
      });
      return;
    }
    void run(
      () => onSave(journeyId, journeyEditsToSave(draft)),
      "Journey updated",
      "Failed to save journey",
    );
  };

  const handleCancel = () => {
    setDraft(null);
    onEnd(false);
  };

  // The trip it is filed under, though the list doesn't have it (still loading,
  // or another region's): shown rather than read as None
  const tripOptions =
    trips && edit.tripId !== null && !trips.some((trip) => trip.id === edit.tripId)
      ? [...trips, { id: edit.tripId, name: "Current trip" }]
      : trips;

  return (
    <div id={formId} className="pt-3 border-t border-gray-200 space-y-4">
      <div>
        <h3 className="text-lg font-bold mb-3">Edit Journey</h3>
        <JourneyMetaFields
          idPrefix={`edit-journey-${journeyId}`}
          name={edit.name}
          onNameChange={(name) => update({ name })}
          date={edit.date}
          onDateChange={(date) => update({ date })}
          description={edit.description}
          onDescriptionChange={(description) => update({ description })}
          trip={
            tripOptions && (tripOptions.length > 0 || base.tripId !== null)
              ? {
                  value: edit.tripId,
                  options: tripOptions,
                  onChange: (tripId) => update({ tripId }),
                }
              : undefined
          }
        />
      </div>

      <div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || missingField !== null}
            aria-describedby={missingField && !isSaving ? "edit-journey-blocked" : undefined}
            className={`${btn("success", "md")} flex-1`}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className={`${btn("subtle", "md")} flex-1`}
          >
            Cancel
          </button>
        </div>
        {missingField && !isSaving && (
          <p id="edit-journey-blocked" className="mt-1.5 text-xs text-gray-500 text-center">
            {missingField}
          </p>
        )}
      </div>
    </div>
  );
}
