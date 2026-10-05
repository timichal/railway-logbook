import TrashIcon from "@/components/ui/TrashIcon";
import { iconBtn } from "@/lib/ui/buttonStyles";

interface LoggedRouteRowProps {
  title: string;
  /**
   * A string as it arrives from a NUMERIC column, which pg does not parse.
   * Unknown while a local journey's route metadata is still loading.
   */
  lengthKm?: number | string | null;
  partial: boolean;
  /**
   * The ridden stretch as fractions along the route, when it is known (a ride the
   * Journey Planner measured) — so a partial ride reads as what was travelled rather
   * than as the whole line. Ignored unless `partial`.
   */
  covered?: { start?: number | null; end?: number | null };
  /** Both handlers, or neither for a read-only row: the journey being looked at, not edited. */
  onPartialChange?: (partial: boolean) => void;
  onRemove?: () => void;
}

/** One route of a journey, in the account and the local journey lists alike. */
export default function LoggedRouteRow({
  title,
  lengthKm,
  partial,
  covered,
  onPartialChange,
  onRemove,
}: LoggedRouteRowProps) {
  const editable = onPartialChange !== undefined && onRemove !== undefined;
  return (
    <div className="p-2 bg-surface border border-gray-200 rounded text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate" title={title}>
          {title}
        </span>
        {editable && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="flex items-center gap-1.5 select-none min-h-11 md:min-h-0 px-1 md:px-0">
              <input
                type="checkbox"
                checked={partial}
                onChange={(e) => onPartialChange(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-gray-500">partial</span>
            </label>
            <button
              type="button"
              onClick={onRemove}
              title="Remove route from journey"
              aria-label="Remove route from journey"
              className={iconBtn("responsive", "danger")}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>
      {lengthKm != null && (
        <div className="text-gray-500 mt-0.5">
          <RouteLength lengthKm={Number(lengthKm)} partial={partial} covered={covered} />
        </div>
      )}
    </div>
  );
}

/**
 * The whole line's length, unless the ride was partial: then the stretch travelled
 * where it is known, and otherwise only that it was part of the line — a partial
 * ride ticked by hand says a piece was ridden without saying which.
 */
function RouteLength({
  lengthKm,
  partial,
  covered,
}: {
  lengthKm: number;
  partial: boolean;
  covered: LoggedRouteRowProps["covered"];
}) {
  const whole = `${lengthKm.toFixed(1)} km`;
  if (!partial) return whole;
  const { start, end } = covered ?? {};
  if (start == null || end == null) {
    return <span className="text-amber-700">partial, of {whole}</span>;
  }
  return (
    <>
      {(Math.abs(end - start) * lengthKm).toFixed(1)} km{" "}
      <span className="text-amber-700">(partial, of {whole})</span>
    </>
  );
}
