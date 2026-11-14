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
}: LoggedRouteRowProps) {
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
