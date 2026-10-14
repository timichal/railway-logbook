"use client";

import { handleJunctionShortcut } from "@/lib/junctionShortcut";

/** The admin forms' text input and label classes. */
export const INPUT =
  "w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-fg";
export const LABEL = "block text-sm font-medium text-gray-700 mb-1";

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** A station name: Alt+J tags it as a junction (`handleJunctionShortcut`). */
  station?: boolean;
  type?: "text" | "url";
  placeholder?: string;
}

/** A labelled one-line input of the admin forms. */
export default function TextField({
  id,
  label,
  value,
  onChange,
  station,
  type = "text",
  placeholder,
}: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={station ? (e) => handleJunctionShortcut(e, onChange) : undefined}
        className={INPUT}
        placeholder={placeholder}
      />
    </div>
  );
}
