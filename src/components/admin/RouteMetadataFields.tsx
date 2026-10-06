"use client";

import TagInput from "@/components/ui/TagInput";
import type { SaveRouteData } from "@/lib/adminRouteActions";
import { handleJunctionShortcut } from "@/lib/junctionShortcut";
import { useRegion } from "@/lib/regionContext";
import { type LineClass, lineClassOptions, type UsageType } from "@/lib/shared/constants";
import { regionUsageOptions } from "@/lib/shared/regions";

/**
 * What the edit form edits: the create form's fields plus the line class, which a
 * new route is given by auto-classification on save rather than by the admin.
 */
export type EditRouteData = SaveRouteData & { line_class: LineClass };

/**
 * Whether a form's required fields are filled — the endpoints, and the name where
 * the region names its lines. Trimmed, as the save trims them: a name of spaces
 * would otherwise enable Save and be stored as an empty string.
 */
export function routeMetadataIncomplete(value: SaveRouteData, hasRouteNames: boolean): boolean {
  return (
    !value.from_station.trim() || !value.to_station.trim() || (hasRouteNames && !value.name.trim())
  );
}

/** The admin forms' text input and label classes, shared with the scenic form. */
export const INPUT =
  "w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-fg";
export const LABEL = "block text-sm font-medium text-gray-700 mb-1";
const GROUP_LABEL = "block text-sm font-medium text-gray-700 mb-2";
const CHECKBOX = "w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500";

interface CommonProps {
  /** Prefixes every element id, so the two forms never share one. */
  idPrefix: string;
  /**
   * "wide" lays the radios and checkboxes out in rows (the create tab); "narrow"
   * stacks them for the edit form's 250px column.
   */
  layout: "wide" | "narrow";
  availableTags: string[];
}

/**
 * `withLineClass` adds the Line class select, and can only be asked for with a
 * value that carries one: a new route is classified on save, so the create form
 * has none to offer.
 */
type RouteMetadataFieldsProps = CommonProps &
  (
    | { withLineClass?: false; value: SaveRouteData; onChange: (value: SaveRouteData) => void }
    | { withLineClass: true; value: EditRouteData; onChange: (value: EditRouteData) => void }
  );

/** The route metadata fields shared by the create and edit forms. */
export default function RouteMetadataFields(props: RouteMetadataFieldsProps) {
  const { value, idPrefix, layout, availableTags } = props;
  const region = useRegion();
  // Japan calls its usage types JR / non-JR lines; Europe keeps the defaults.
  const usageOptions = regionUsageOptions(region.id);
  const narrow = layout === "narrow";
  const lineClass = props.withLineClass ? props.value.line_class : undefined;
  // A patch spread over the value keeps its variant (a line_class patch comes only
  // from the select, which only the EditRouteData variant renders); the compiler
  // cannot follow that across the union, hence the cast.
  const set = (patch: Partial<EditRouteData>) =>
    props.onChange({ ...props.value, ...patch } as EditRouteData);

  const intendedBacktracking = (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={value.intended_backtracking}
        onChange={(e) => set({ intended_backtracking: e.target.checked })}
        className={CHECKBOX}
      />
      <span className="text-sm font-medium text-gray-700">Intended backtracking</span>
    </label>
  );

  const lineClassSelect = lineClass !== undefined && (
    <div>
      <label htmlFor={`${idPrefix}-line-class`} className={LABEL}>
        Line class
      </label>
      <select
        id={`${idPrefix}-line-class`}
        value={lineClass}
        onChange={(e) => set({ line_class: e.target.value as LineClass })}
        className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm text-fg"
      >
        {lineClassOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      {/* Line Name — only where the region names its lines (Japan) */}
      {region.hasRouteNames && (
        <div>
          <label htmlFor={`${idPrefix}-name`} className={LABEL}>
            Name *
          </label>
          <input
            id={`${idPrefix}-name`}
            type="text"
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
            className={INPUT}
            placeholder="Line name"
          />
        </div>
      )}

      <div>
        <label htmlFor={`${idPrefix}-from`} className={LABEL}>
          From *
        </label>
        <input
          id={`${idPrefix}-from`}
          type="text"
          value={value.from_station}
          onChange={(e) => set({ from_station: e.target.value })}
          onKeyDown={(e) => handleJunctionShortcut(e, (from_station) => set({ from_station }))}
          className={INPUT}
          placeholder="Starting station"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-to`} className={LABEL}>
          To *
        </label>
        <input
          id={`${idPrefix}-to`}
          type="text"
          value={value.to_station}
          onChange={(e) => set({ to_station: e.target.value })}
          onKeyDown={(e) => handleJunctionShortcut(e, (to_station) => set({ to_station }))}
          className={INPUT}
          placeholder="Ending station"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className={LABEL}>
          Description
        </label>
        <textarea
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={narrow ? 5 : 3}
          className={INPUT}
          placeholder="Enter route description"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-link`} className={LABEL}>
          Link (URL)
        </label>
        <input
          id={`${idPrefix}-link`}
          type="url"
          value={value.link}
          onChange={(e) => set({ link: e.target.value })}
          className={INPUT}
          placeholder="https://example.com"
        />
      </div>

      <div>
        <span className={GROUP_LABEL}>Usage Type *</span>
        <div className={narrow ? "space-y-2" : "flex gap-4"}>
          {usageOptions.map((option) => (
            <label key={option.key} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-usage-type`}
                value={option.id}
                checked={value.usage_type === option.id}
                onChange={(e) => set({ usage_type: Number(e.target.value) as UsageType })}
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className={GROUP_LABEL}>Frequency Tags</span>
        <TagInput
          value={value.frequency}
          availableTags={availableTags}
          onChange={(frequency) => set({ frequency })}
        />
      </div>

      <span className={GROUP_LABEL}>Other</span>
      {narrow ? (
        <>
          {lineClassSelect}
          <div>{intendedBacktracking}</div>
        </>
      ) : (
        <>
          <div>{intendedBacktracking}</div>
          {lineClassSelect}
        </>
      )}
    </>
  );
}
