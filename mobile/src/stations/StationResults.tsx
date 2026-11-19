/**
 * The list under a search field.
 *
 * `StationResults` is the planner fields' list; the map's search box builds its own
 * from the same pieces (`SearchResultList`, `SearchResultRow`), since it lists lines
 * as well where the region names them. They are the same list of the same things and
 * only differ in what a pick does with it.
 *
 * The web app's equivalent is an absolutely-positioned dropdown that has to fight the
 * field's own blur to stay open long enough to be tapped (`StationSearchInput`, and
 * the `preventDefault` on pointerdown that keeps focus where it is). None of that
 * ports: here the list is an ordinary sibling in the layout, a press on a row is
 * delivered to that row, and focus has nothing to do with it. What does port is the
 * dismissal of the keyboard on a pick, which the callers do — a list of results is
 * useless under a keyboard covering the map it is about to fly to.
 */
import { MIN_SEARCH_QUERY_LENGTH } from "@shared/constants";
import type { Station } from "@shared/types";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

interface SearchResultListProps {
  /** How many rows `children` holds. */
  count: number;
  searching: boolean;
  /** Why the search has no answer, when it failed (`useNameSearch`). */
  error: string | null;
  /** How long the text in the field is, so "nothing found" is only said once it means it. */
  queryLength: number;
  /** What an answer with nothing in it says. */
  emptyLabel: string;
  /**
   * Rows that scroll within whatever height the parent leaves, clear of the
   * keyboard: the map's box floats over the map, where nothing else would scroll it.
   * The planner's lists sit in the form's own `ScrollView` and leave this off.
   */
  scrollable?: boolean;
  children: ReactNode;
}

export function SearchResultList({
  count,
  searching,
  error,
  queryLength,
  emptyLabel,
  scrollable = false,
  children,
}: SearchResultListProps): ReactNode {
  // Under the server's floor it answers with none, which is not "no match"
  if (queryLength < MIN_SEARCH_QUERY_LENGTH) return null;

  if (count === 0) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2">
        {searching ? <ActivityIndicator size="small" /> : null}
        <Text
          className={`text-sm ${
            error && !searching
              ? "text-red-600 dark:text-red-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {searching ? "Searching…" : (error ?? emptyLabel)}
        </Text>
      </View>
    );
  }

  const frame = "overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700";
  if (!scrollable) return <View className={frame}>{children}</View>;

  // `shrink` all the way down: a column's children don't shrink by default here, so
  // without it the list would run past the height it was given rather than scroll.
  return (
    <View className={`shrink ${frame}`}>
      <ScrollView
        className="grow-0"
        keyboardShouldPersistTaps="handled"
        // iOS: the rows behind the keyboard scroll up past it. Android resizes the
        // window instead, which shrinks the space the list is given.
        automaticallyAdjustKeyboardInsets
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function SearchResultRow({
  title,
  detail,
  first,
  accessibilityLabel,
  onPress,
}: {
  title: string;
  /** A second, smaller line: what kind of result this is. */
  detail?: string;
  /** The top row draws no divider above itself. */
  first: boolean;
  accessibilityLabel?: string;
  onPress(): void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={`min-h-11 justify-center bg-white px-3 py-2 active:bg-gray-100 dark:bg-gray-800 dark:active:bg-gray-700 ${
        first ? "" : "border-t border-gray-200 dark:border-gray-700"
      }`}
    >
      <Text className="text-sm text-gray-900 dark:text-gray-100">{title}</Text>
      {detail ? (
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{detail}</Text>
      ) : null}
    </Pressable>
  );
}

interface StationResultsProps {
  results: Station[];
  searching: boolean;
  error: string | null;
  queryLength: number;
  onSelect(station: Station): void;
}

export function StationResults({
  results,
  searching,
  error,
  queryLength,
  onSelect,
}: StationResultsProps): ReactNode {
  return (
    <SearchResultList
      count={results.length}
      searching={searching}
      error={error}
      queryLength={queryLength}
      emptyLabel="No stations found."
    >
      {results.map((station, index) => (
        <SearchResultRow
          key={station.id}
          title={station.name}
          first={index === 0}
          onPress={() => onSelect(station)}
        />
      ))}
    </SearchResultList>
  );
}
