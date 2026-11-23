import type { CSSProperties } from "react";
import type { RouteBadge } from "@/lib/shared/map/routeFeature";

/**
 * One route badge (`closedRowBadge`) as a chip, matching the map popup's
 * (`formatRouteMetadataBadges`). Its colours are data rather than classes, so both
 * schemes' go in as custom properties and `dark:` picks between them, following
 * `html.dark` as every other colour does.
 */
export default function RouteBadgeChip({ badge }: { badge: RouteBadge }) {
  const colors = {
    "--badge-bg": badge.bgColor,
    "--badge-fg": badge.color,
    "--badge-bg-dark": badge.dark.bgColor,
    "--badge-fg-dark": badge.dark.color,
  } as CSSProperties;
  return (
    <span
      style={colors}
      className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold leading-snug bg-(--badge-bg) text-(--badge-fg) dark:bg-(--badge-bg-dark) dark:text-(--badge-fg-dark)"
    >
      {badge.label}
    </span>
  );
}
