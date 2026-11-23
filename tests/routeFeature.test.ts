import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  chainClosedBadge,
  closedLabel,
  closedRowBadge,
  parseTextArray,
  routeLinkLabel,
  routeTitle,
} from "@/lib/shared/map/routeFeature";

describe("parseTextArray", () => {
  test("takes the array as it is, empty tags dropped", () => {
    assert.deepEqual(parseTextArray(["Daily", "", "Mon, Wed"]), ["Daily", "Mon, Wed"]);
  });

  test("nothing at all", () => {
    assert.deepEqual(parseTextArray(undefined), []);
    assert.deepEqual(parseTextArray(""), []);
    assert.deepEqual(parseTextArray([""]), []);
  });
});

describe("routeTitle", () => {
  const shared = {
    from_station: "Nagoya",
    to_station: "Kanayama",
    name: "Tokaido Main Line",
    other_names: ["Chuo Main Line"],
  };

  test("names the other lines sharing the route", () => {
    assert.deepEqual(routeTitle(shared, "japan"), {
      name: "Tokaido Main Line",
      alsoOn: "Also Chuo Main Line",
      endpoints: "Nagoya ⟷ Kanayama",
    });
    assert.equal(
      routeTitle({ ...shared, other_names: ["Chuo Main Line", "Kansai Main Line"] }, "japan")
        .alsoOn,
      "Also Chuo Main Line, Kansai Main Line",
    );
  });

  test("no other lines without a name to lead", () => {
    assert.equal(routeTitle({ ...shared, name: " " }, "japan").alsoOn, null);
    assert.equal(routeTitle(shared, "europe").alsoOn, null);
    assert.equal(routeTitle({ ...shared, other_names: [] }, "japan").alsoOn, null);
  });
});

describe("routeLinkLabel", () => {
  test("the admin's name for the link", () => {
    assert.equal(routeLinkLabel(" Ffestiniog Railway "), "Ffestiniog Railway");
  });

  test("Website without one", () => {
    assert.equal(routeLinkLabel(null), "Website");
    assert.equal(routeLinkLabel(undefined), "Website");
    assert.equal(routeLinkLabel(""), "Website");
    assert.equal(routeLinkLabel("  "), "Website");
  });
});

describe("closedLabel", () => {
  test("the month and year where the day is known, as mm/yyyy", () => {
    assert.equal(closedLabel("2024-12-15"), "Closed 12/2024");
    assert.equal(closedLabel("2025-03-01"), "Closed 03/2025");
  });

  test("just Closed where it isn't", () => {
    assert.equal(closedLabel(null), "Closed");
    assert.equal(closedLabel(""), "Closed");
    assert.equal(closedLabel(undefined), "Closed");
  });
});

describe("closedRowBadge", () => {
  const open = { closed: false, closed_on: null };
  const label = (routes: Parameters<typeof closedRowBadge>[0]) => closedRowBadge(routes)?.label;

  test("no badge when nothing is closed", () => {
    assert.equal(closedRowBadge([open, { closed: null }]), null);
    assert.equal(closedRowBadge([]), null);
  });

  test("every route closed reads as one would, the month only where they agree", () => {
    assert.equal(label([{ closed: true, closed_on: "2025-12-14" }]), "Closed 12/2025");
    assert.equal(
      label([
        { closed: true, closed_on: "2025-12-01" },
        { closed: true, closed_on: "2025-12-14" },
      ]),
      "Closed 12/2025",
    );
    assert.equal(
      label([
        { closed: true, closed_on: "2025-12-14" },
        { closed: true, closed_on: "2024-06-01" },
      ]),
      "Closed",
    );
  });

  test("an undated closure drops the month rather than borrowing the others'", () => {
    assert.equal(
      label([
        { closed: true, closed_on: "2025-12-14" },
        { closed: true, closed_on: null },
      ]),
      "Closed",
    );
  });

  test("some closed is partly closed", () => {
    assert.equal(label([{ closed: true, closed_on: "2025-12-14" }, open]), "Partly closed");
  });
});

describe("chainClosedBadge", () => {
  const routes = [
    { track_id: 1, closed: true, closed_on: "2025-12-14" },
    { track_id: 2, closed: false },
    { track_id: 3, closed: true, closed_on: "2025-12-01" },
  ];

  test("looks only at the chain's own routes", () => {
    assert.equal(chainClosedBadge([1, 3], routes)?.label, "Closed 12/2025");
    assert.equal(chainClosedBadge([1, 2], routes)?.label, "Partly closed");
    assert.equal(chainClosedBadge([2], routes), null);
  });
});
