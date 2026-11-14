import type { JourneyChain } from "@/lib/journeyChains";
import { pickRow } from "@/lib/ui/buttonStyles";

interface JourneyChainListProps {
  chains: JourneyChain[];
  /** The chain the map shows on its own, by index; null for the whole journey. */
  picked: number | null;
  onPick: (index: number | null) => void;
}

/**
 * An open journey as the lines of stations it rode (see `journeyChains`), each with
 * the distance travelled along it. Pressing one shows it alone on the map, and
 * pressing it again brings back the whole journey.
 */
export default function JourneyChainList({ chains, picked, onPick }: JourneyChainListProps) {
  // One line needs no picking out: it is the whole journey
  const pickable = chains.length > 1;
  return (
    <ul className="space-y-1.5">
      {chains.map((chain, index) => {
        const content = <ChainContent chain={chain} />;
        return (
          <li key={chain.trackIds[0]}>
            {pickable ? (
              <button
                type="button"
                aria-pressed={picked === index}
                onClick={() => onPick(picked === index ? null : index)}
                className={pickRow(picked === index)}
              >
                {content}
              </button>
            ) : (
              <div className="rounded-md border border-gray-200 bg-surface px-2.5 py-2">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChainContent({ chain }: { chain: JourneyChain }) {
  const last = chain.stops.length - 1;
  return (
    <>
      <span className="block text-sm text-fg leading-snug">
        {chain.stops.map((stop, i) => (
          // Stops repeat (a loop starts and ends at one station), so keyed by place
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt whole and never reordered.
          <span key={i}>
            {i > 0 && <span className="text-gray-400"> – </span>}
            {/* Kept whole, so a line breaks between stations rather than inside one */}
            <span
              className="whitespace-nowrap"
              title={
                i === 0 && chain.startsPartway
                  ? `Boarded between ${stop} and ${chain.stops[1]}`
                  : i === last && chain.endsPartway
                    ? `Left the train between ${chain.stops[last - 1]} and ${stop}`
                    : undefined
              }
            >
              {i === 0 && chain.startsPartway && <span className="text-gray-400">…</span>}
              {stop}
              {i === last && chain.endsPartway && <span className="text-gray-400">…</span>}
            </span>
          </span>
        ))}
      </span>
      <span className="block mt-0.5 text-xs text-gray-500">
        {chain.lengthKm.toFixed(1)} km
        {chain.unknownExtent && (
          <span
            className="text-amber-700"
            title="Includes a route ridden only in part, counted whole"
          >
            {" "}
            · partial
          </span>
        )}
      </span>
    </>
  );
}
