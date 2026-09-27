interface TripPicker {
  value: number | null;
  options: { id: number; name: string }[];
  onChange: (tripId: number | null) => void;
}

interface JourneyMetaFieldsProps {
  /** Prefix of the inputs' ids, unique per form on the page. */
  idPrefix: string;
  /** Smaller type and padding, for a form inside a journey card. */
  compact?: boolean;
  name: string;
  onNameChange: (name: string) => void;
  date: string;
  onDateChange: (date: string) => void;
  onDateFocus?: () => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  /** Only a signed-in user's journeys belong to trips; omitted, the field is not drawn. */
  trip?: TripPicker;
}

/** Name, date, description and trip of a journey — the new-journey form and both edit forms. */
export default function JourneyMetaFields({
  idPrefix,
  compact = false,
  name,
  onNameChange,
  date,
  onDateChange,
  onDateFocus,
  description,
  onDescriptionChange,
  trip,
}: JourneyMetaFieldsProps) {
  const labelClass = `block ${compact ? "text-xs" : "text-sm"} font-medium mb-1`;
  const fieldClass = `w-full border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"
  }`;

  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={labelClass}>
          Journey Name*
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          // An example is for a new journey; an edited one already has a name
          placeholder={compact ? undefined : "e.g., Prague to Vienna via Brno"}
          className={fieldClass}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-date`} className={labelClass}>
          Date*
        </label>
        <input
          id={`${idPrefix}-date`}
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          onFocus={onDateFocus}
          className={fieldClass}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className={labelClass}>
          Description
        </label>
        <textarea
          id={`${idPrefix}-description`}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={2}
          placeholder={compact ? undefined : "Optional notes about this journey..."}
          className={`${fieldClass} resize-none`}
        />
      </div>

      {trip && (
        <div>
          <label htmlFor={`${idPrefix}-trip`} className={labelClass}>
            Trip
          </label>
          <select
            id={`${idPrefix}-trip`}
            value={trip.value ?? ""}
            onChange={(e) => trip.onChange(e.target.value ? Number(e.target.value) : null)}
            className={fieldClass}
          >
            <option value="">None</option>
            {trip.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
