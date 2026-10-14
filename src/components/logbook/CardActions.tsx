"use client";

import { type RefObject, useRef, useState } from "react";
import { type ButtonVariant, btn } from "@/lib/ui/buttonStyles";
import { useFocusAfterRender } from "@/lib/ui/useFocusAfterRender";

interface CardActionsProps {
  editLabel: string;
  editVariant: ButtonVariant;
  /** The card focuses it when its edit form closes and this row comes back. */
  editButtonRef: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
  deleteLabel: string;
  /** The confirmation's question, beside Delete and Cancel. */
  question: string;
  /** Resolves false when the delete failed, which brings the row back. */
  onDelete: () => Promise<boolean>;
  /** A rule above the row, where it follows other content of the card. */
  divided?: boolean;
}

/**
 * The bottom row of an open trip or journey card: Edit and Delete, with Delete
 * asking first. Focus follows the swap both ways, to Cancel and back to Delete.
 * While the delete is on its way both buttons are disabled, so a double tap sends
 * one request and Cancel can't bring back the row of something being deleted.
 *
 * The confirmation is local state, so it is gone whenever the row unmounts — the
 * card closing or its edit form opening.
 */
export default function CardActions({
  editLabel,
  editVariant,
  editButtonRef,
  onEdit,
  deleteLabel,
  question,
  onDelete,
  divided = false,
}: CardActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const focusAfterRender = useFocusAfterRender();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const ask = () => {
    setConfirming(true);
    focusAfterRender(() => cancelButtonRef.current);
  };

  const cancel = () => {
    setConfirming(false);
    focusAfterRender(() => deleteButtonRef.current);
  };

  const confirm = async () => {
    setDeleting(true);
    try {
      if (!(await onDelete())) cancel();
    } finally {
      setDeleting(false);
    }
  };

  const row = divided
    ? "flex items-center gap-2 pt-2 border-t border-gray-200"
    : "flex items-center gap-2";

  return confirming ? (
    <div className={row}>
      <span className="flex-1 text-sm text-gray-700">{question}</span>
      <button
        type="button"
        onClick={confirm}
        disabled={deleting}
        className={`${btn("danger")} flex-shrink-0`}
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
      <button
        type="button"
        ref={cancelButtonRef}
        onClick={cancel}
        disabled={deleting}
        className={`${btn("subtle")} flex-shrink-0`}
      >
        Cancel
      </button>
    </div>
  ) : (
    <div className={`${row} justify-between`}>
      <button type="button" ref={editButtonRef} onClick={onEdit} className={btn(editVariant)}>
        {editLabel}
      </button>
      <button type="button" ref={deleteButtonRef} onClick={ask} className={btn("softDanger")}>
        {deleteLabel}
      </button>
    </div>
  );
}
