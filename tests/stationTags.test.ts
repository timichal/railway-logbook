import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isMetroOnlyStation } from "@/scripts/lib/stationTags";

describe("isMetroOnlyStation", () => {
  test("a station metro and trains share lists both modes, and is kept", () => {
    assert.equal(
      isMetroOnlyStation({ subway: "yes", train: "yes", station: "train;subway" }),
      false,
    );
    assert.equal(
      isMetroOnlyStation({ subway: "yes", train: "yes", station: "subway;train" }),
      false,
    );
    assert.equal(isMetroOnlyStation({ subway: "yes", station: "subway; light_rail" }), false);
  });

  test("station=subway alone is metro-only, train=yes or not", () => {
    assert.equal(isMetroOnlyStation({ subway: "yes", train: "yes", station: "subway" }), true);
    assert.equal(isMetroOnlyStation({ subway: "yes", station: "subway" }), true);
  });

  test("without a station tag, train=yes decides", () => {
    assert.equal(isMetroOnlyStation({ subway: "yes", train: "yes" }), false);
    assert.equal(isMetroOnlyStation({ subway: "yes" }), true);
  });

  test("subway=no, or no subway tag, is no metro", () => {
    assert.equal(isMetroOnlyStation({ subway: "no", station: "light_rail" }), false);
    assert.equal(isMetroOnlyStation({ station: "subway" }), false);
    assert.equal(isMetroOnlyStation({}), false);
  });
});
