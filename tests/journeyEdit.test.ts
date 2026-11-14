import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type JourneySnapshot,
  journeyEditChanged,
  journeyEditsToSave,
  journeyRouteChanges,
  selectionFromJourney,
} from "@/lib/journeyEdit";
import type { RailwayRoute, SelectedRoute } from "@/lib/shared/types";

function logged(track_id: number, extra: Partial<RailwayRoute> = {}): RailwayRoute {
  return {
    track_id,
    from_station: "A",
    to_station: "B",
    description: null,
    usage_type: 0,
    usage_tags: [],
    geometry: "",
    length_km: 10,
    partial: false,
    covered_start: null,
    covered_end: null,
    ...extra,
  };
}

const stretch = (track_id: number, covered_start: number, covered_end: number) => ({
  track_id,
  covered_start,
  covered_end,
  coordinates: [[0, 0] as [number, number]],
  usage_type: 0 as const,
});

describe("selectionFromJourney", () => {
  test("a partial ride of known extent keeps its stretch and travelled length", () => {
    const [route] = selectionFromJourney(
      [logged(1, { partial: true, covered_start: 0.2, covered_end: 0.7 })],
      [stretch(1, 0.2, 0.7)],
    );
    assert.equal(route.partial, true);
    assert.equal(route.covered?.covered_start, 0.2);
    assert.equal(route.covered?.coordinates.length, 1);
    assert.ok(Math.abs((route.travelled_length_km ?? 0) - 5) < 1e-9);
  });

  test("keeps a stretch the load did not cut, with nothing to draw", () => {
    const [route] = selectionFromJourney(
      [logged(1, { partial: true, covered_start: 0.2, covered_end: 0.7 })],
      [],
    );
    assert.deepEqual(
      [route.covered?.covered_start, route.covered?.covered_end, route.covered?.coordinates],
      [0.2, 0.7, []],
    );
  });

  test("a whole ride, or one ticked partial by hand, has none", () => {
    const routes = selectionFromJourney([logged(1), logged(2, { partial: true })], []);
    assert.deepEqual(
      routes.map((r) => [r.partial, r.covered]),
      [
        [false, null],
        [true, null],
      ],
    );
  });
});

describe("journeyRouteChanges", () => {
  const base = selectionFromJourney(
    [logged(1), logged(2, { partial: true, covered_start: 0, covered_end: 0.5 })],
    [stretch(2, 0, 0.5)],
  );

  test("an untouched selection changes nothing", () => {
    assert.deepEqual(journeyRouteChanges(base, base), { upsert: [], remove: [] });
  });

  test("sends added routes and removed ones", () => {
    const added: SelectedRoute = { ...base[0], track_id: 3 };
    assert.deepEqual(journeyRouteChanges(base, [base[1], added]), {
      upsert: [{ trackId: 3, partial: false, range: null }],
      remove: [1],
    });
  });

  test("unticking partial sends the route whole, without its stretch", () => {
    const edit = [base[0], { ...base[1], partial: false }];
    assert.deepEqual(journeyRouteChanges(base, edit).upsert, [
      { trackId: 2, partial: false, range: null },
    ]);
  });

  test("a stretch re-measured by the planner is sent", () => {
    const edit = [base[0], { ...base[1], covered: stretch(2, 0, 0.8) }];
    assert.deepEqual(journeyRouteChanges(base, edit).upsert, [
      { trackId: 2, partial: true, range: { covered_start: 0, covered_end: 0.8 } },
    ]);
  });
});

describe("journeyEditChanged", () => {
  const snapshot: JourneySnapshot = {
    name: "Trip",
    date: "2026-01-01",
    description: "",
    tripId: null,
    routes: [],
  };

  test("whitespace alone is no change", () => {
    assert.equal(
      journeyEditChanged({ base: snapshot, edit: { ...snapshot, name: " Trip " } }),
      false,
    );
  });

  test("a field or a route is", () => {
    assert.equal(journeyEditChanged({ base: snapshot, edit: { ...snapshot, tripId: 4 } }), true);
    const routes = selectionFromJourney([logged(1)], []);
    assert.equal(journeyEditChanged({ base: snapshot, edit: { ...snapshot, routes } }), true);
  });
});

describe("journeyEditsToSave", () => {
  const snapshot: JourneySnapshot = {
    name: "Trip",
    date: "2026-01-01",
    description: "Notes",
    tripId: 3,
    routes: [],
  };

  test("sends only the fields the edit changed", () => {
    const edits = journeyEditsToSave({
      base: snapshot,
      edit: { ...snapshot, date: "2026-01-02" },
    });
    assert.deepEqual(edits, {
      name: undefined,
      description: undefined,
      date: "2026-01-02",
      tripId: undefined,
      upsert: [],
      remove: [],
    });
  });

  test("a cleared description is sent as null, a trimmed name as trimmed", () => {
    const edits = journeyEditsToSave({
      base: snapshot,
      edit: { ...snapshot, name: " Other ", description: "  ", tripId: null },
    });
    assert.equal(edits.name, "Other");
    assert.equal(edits.description, null);
    assert.equal(edits.tripId, null);
  });
});
