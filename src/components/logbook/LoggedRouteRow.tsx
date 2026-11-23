import RouteBadgeChip from "@/components/ui/RouteBadgeChip";
import { closedRowBadge } from "@/lib/shared/map/routeFeature";

interface LoggedRouteRowProps {
  title: string;
  /** A second line under the title — the endpoints, where the title is a line name. */
  subtitle?: string;
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
  /** The route no longer has passenger service (railway_routes.closed), and since when. */
  closed?: boolean | null;
  closedOn?: string | null;
}

/**
 * One route of an open journey, in the account and the local journey lists alike.
 * Read-only: a journey is edited in the Route Logger.
 */
export default function LoggedRouteRow({
  title,
  subtitle,
  lengthKm,
  partial,
  covered,
  closed,
  closedOn,
}: LoggedRouteRowProps) {
  const closure = closedRowBadge([{ closed, closed_on: closedOn }]);
  return (
    <div className="p-2 bg-surface border border-gray-200 rounded text-xs">
      <div className="min-w-0">
        <div className="font-medium truncate" title={title}>
          {title}
        </div>
        {subtitle && (
          <div className="text-gray-500 truncate" title={subtitle}>
            {subtitle}
          </div>
        )}
      </div>
      {(lengthKm != null || closure) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-gray-500">
          {lengthKm != null && (
            <span>
              <RouteLength lengthKm={Number(lengthKm)} partial={partial} covered={covered} />
            </span>
          )}
          {closure && <RouteBadgeChip badge={closure} />}
        </div>
      )}
    </div>
  );
}

/**
 * The whole line's length, unless the ride was partial: then the stretch travelled,
 * of the whole line.
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
  const { start, end } = covered ?? {};
  // A partial ride always carries its stretch (`loggedRide`)
  if (!partial || start == null || end == null) return whole;
  return (
    <>
      {(Math.abs(end - start) * lengthKm).toFixed(1)} km{" "}
      <span className="text-amber-700">(partial, of {whole})</span>
    </>
  );
}
