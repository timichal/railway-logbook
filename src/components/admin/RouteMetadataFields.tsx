"use client";

import TextField, { INPUT, LABEL } from "@/components/admin/TextField";
import TagInput from "@/components/ui/TagInput";
import type { RouteSuggestions, SaveRouteData } from "@/lib/adminRouteActions";
import { useRegion } from "@/lib/regionContext";
import { foldForSearch } from "@/lib/searchText";
import { type LineClass, lineClassOptions, type UsageType } from "@/lib/shared/constants";
import { regionUsageOptions } from "@/lib/shared/regions";

/**
 * What the edit form edits: the create form's fields plus the line class, which a
 * new route is given by auto-classification on save rather than by the admin.
 */
export type EditRouteData = SaveRouteData & { line_class: LineClass };

/** The suggestions before they have loaded (see `getRouteSuggestions`). */
export const NO_ROUTE_SUGGESTIONS: RouteSuggestions = { tags: [], lineNames: [] };

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
  suggestions: RouteSuggestions;
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
  const { value, idPrefix, layout, suggestions } = props;
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
      {/* Line Name — only where the region names its lines (Japan). Also part of:
          the other lines sharing this stretch, whose line search then includes it. */}
      {region.hasRouteNames && (
        <>
          <TextField
            id={`${idPrefix}-name`}
            label="Name *"
            value={value.name}
            onChange={(name) => set({ name })}
            placeholder="Line name"
          />
          <div>
            <span className={GROUP_LABEL}>Also part of</span>
            <TagInput
              value={value.other_names}
              availableTags={suggestions.lineNames}
              exclude={[value.name]}
              fold={foldForSearch}
              onChange={(other_names) => set({ other_names })}
              placeholder="Add a line…"
            />
          </div>
        </>
      )}
      <TextField
        id={`${idPrefix}-from`}
        label="From *"
        value={value.from_station}
        onChange={(from_station) => set({ from_station })}
        station
        placeholder="Starting station"
      />
      <TextField
        id={`${idPrefix}-to`}
        label="To *"
        value={value.to_station}
        onChange={(to_station) => set({ to_station })}
        station
        placeholder="Ending station"
      />

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

      <TextField
        id={`${idPrefix}-link`}
        label="Link (URL)"
        type="url"
        value={value.link}
        onChange={(link) => set({ link })}
        placeholder="https://example.com"
      />

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
          availableTags={suggestions.tags}
          onChange={(frequency) => set({ frequency })}
        />
      </div>

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
