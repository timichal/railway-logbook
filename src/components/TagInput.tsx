"use client";

import { useMemo, useState } from "react";

interface TagInputProps {
  /** Currently selected tags. */
  value: string[];
  onChange: (tags: string[]) => void;
  /** All tags already in use elsewhere, used for autocomplete suggestions. */
  availableTags?: string[];
  placeholder?: string;
}

/**
 * GitLab-labels-style tag editor: selected tags render as removable chips, and
 * a single input lets you either pick an existing tag (filtered autocomplete)
 * or create a new one on the fly. Tags are plain strings — there is no separate
 * tag store, so a tag simply disappears once no route uses it.
 */
export default function TagInput({
  value,
  onChange,
  availableTags = [],
  placeholder = "Search or create a tag…",
}: TagInputProps) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const query = input.trim();

  const suggestions = useMemo(() => {
    const lower = query.toLowerCase();
    return availableTags
      .filter((tag) => !value.some((v) => v.toLowerCase() === tag.toLowerCase()))
      .filter((tag) => tag.toLowerCase().includes(lower))
      .sort((a, b) => a.localeCompare(b));
  }, [availableTags, value, query]);

  const exactExists =
    query.length > 0 &&
    [...value, ...availableTags].some((tag) => tag.toLowerCase() === query.toLowerCase());
  const canCreate = query.length > 0 && !exactExists;

  // Flat option list: existing matches first, then an optional "create" row.
  const options = useMemo(() => {
    const opts: Array<{ type: "existing" | "create"; value: string }> = suggestions.map((tag) => ({
      type: "existing",
      value: tag,
    }));
    if (canCreate) opts.push({ type: "create", value: query });
    return opts;
  }, [suggestions, canCreate, query]);

  const safeHighlight = options.length === 0 ? 0 : Math.min(highlight, options.length - 1);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (!value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...value, trimmed]);
    }
    setInput("");
    setHighlight(0);
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[safeHighlight];
      if (opt) addTag(opt.value);
      else if (query) addTag(query);
    } else if (e.key === "Backspace" && input === "" && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 border border-gray-300 rounded-md focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-green-700 hover:text-green-900 leading-none cursor-pointer"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] text-sm outline-none text-black bg-transparent"
        />
      </div>

      {open && options.length > 0 && (
        <ul
          // Keep focus on the input so onBlur doesn't fire before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg py-1"
        >
          {options.map((opt, i) => (
            <li key={`${opt.type}-${opt.value}`}>
              <button
                type="button"
                onClick={() => addTag(opt.value)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-sm cursor-pointer ${
                  i === safeHighlight ? "bg-blue-50 text-blue-700" : "text-gray-700"
                }`}
              >
                {opt.type === "create" ? (
                  <>
                    Create{" "}
                    <span className="inline-flex items-center bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded">
                      {opt.value}
                    </span>
                  </>
                ) : (
                  opt.value
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
