import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  loggedLengthKm,
  type PlannedLeg,
  selectionLengthKm,
  suggestJourneyName,
} from "@/lib/selectedRoutes";
import type { SelectedRoute } from "@/lib/shared/types";

function route(
  track_id: number,
  from_station: string,
  to_station: string,
  extra: Partial<SelectedRoute> = {},
): SelectedRoute {
  return {
    track_id,
    from_station,
    to_station,
    description: "",
    usage_types: "",
    link: null,
    date: null,
    journey_name: null,
    partial: null,
    length_km: 10,
    ...extra,
  };
}

function leg(from: string, to: string, trackIds: number[], via: string[] = []): PlannedLeg {
  return { stops: { from, via, to }, trackIds };
}

describe("loggedLengthKm", () => {
  test("a planner-partial route counts its travelled stretch", () => {
    assert.equal(loggedLengthKm(route(1, "A", "B", { partial: true, travelled_length_km: 4 })), 4);
  });

  test("unticking partial claims the whole route", () => {
    assert.equal(
      loggedLengthKm(route(1, "A", "B", { partial: false, travelled_length_km: 4 })),
      10,
    );
  });

  test("a route ticked partial by hand has no known stretch and counts whole", () => {
    assert.equal(loggedLengthKm(route(1, "A", "B", { partial: true })), 10);
  });

  test("selectionLengthKm sums the logged lengths", () => {
    const routes = [
      route(1, "A", "B"),
      route(2, "B", "C", { partial: true, travelled_length_km: 2.5 }),
    ];
    assert.equal(selectionLengthKm(routes), 12.5);
  });
});

describe("suggestJourneyName", () => {
  test("a single route is named after its endpoints", () => {
    assert.equal(suggestJourneyName([], [route(1, "A", "B")]), "A to B");
  });

  test("a chain is named after its two ends, starting on the first route picked", () => {
    const routes = [route(1, "B", "A"), route(2, "B", "C"), route(3, "D", "C")];
    assert.equal(suggestJourneyName([], routes), "A to D");
  });

  test("a loop or a branching selection gets no suggestion", () => {
    const loop = [route(1, "A", "B"), route(2, "B", "C"), route(3, "C", "A")];
    assert.equal(suggestJourneyName([], loop), null);
    const branch = [route(1, "A", "B"), route(2, "B", "C"), route(3, "B", "D")];
    assert.equal(suggestJourneyName([], branch), null);
  });

  test("a plan's stations win over the routes' endpoints", () => {
    const routes = [route(1, "X", "Y")];
    assert.equal(suggestJourneyName([leg("P", "Q", [1], ["V"])], routes), "P to Q via V");
  });

  test("consecutive plans join where one ends and the next begins", () => {
    const routes = [route(1, "A", "B"), route(2, "B", "C")];
    assert.equal(
      suggestJourneyName([leg("A", "B", [1]), leg("B", "C", [2])], routes),
      "A to C via B",
    );
  });

  test("an out-and-back plan is a round trip", () => {
    assert.equal(
      suggestJourneyName([leg("A", "A", [1], ["B"])], [route(1, "A", "B")]),
      "A round trip via B",
    );
  });

  test("a plan whose routes are all gone no longer counts", () => {
    const routes = [route(5, "Olomouc", "Ostrava")];
    assert.equal(suggestJourneyName([leg("Prague", "Brno", [1, 2])], routes), "Olomouc to Ostrava");
  });

  test("falls back to the selection when the plans name fewer than two stops", () => {
    assert.equal(suggestJourneyName([leg("A", "A", [1])], [route(1, "A", "B")]), "A to B");
  });
});
