import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  closedLabel,
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
