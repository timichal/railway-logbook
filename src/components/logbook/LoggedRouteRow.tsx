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
  onPartialChange: (partial: boolean) => void;
  onRemove: () => void;
}

/** One route of a journey open for editing, in the account and the local journey lists alike. */
export default function LoggedRouteRow({
  title,
  lengthKm,
  partial,
  onPartialChange,
  onRemove,
}: LoggedRouteRowProps) {
  return (
    <div className="p-2 bg-surface border border-gray-200 rounded text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{title}</span>
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
      </div>
      {lengthKm != null && (
        <div className="text-gray-500 mt-0.5">{Number(lengthKm).toFixed(1)} km</div>
      )}
    </div>
  );
}
