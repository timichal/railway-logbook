import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parseStoredLayerPrefs,
  resolveLayerPrefs,
  withLayerPref,
} from "@/lib/shared/map/layerPrefs";
import { clickBufferFilter, shownUsageTypes } from "@/lib/shared/map/userMapLayers";
import { countedUsageTypes, ordinaryUsageSql } from "@/lib/shared/regions";

describe("layer prefs", () => {
  test("nothing stored: Special shown only where it is ordinary service", () => {
    const stored = parseStoredLayerPrefs(null);
    assert.deepEqual(resolveLayerPrefs(stored, "europe"), {
      showRegular: true,
      showHeritage: false,
      showSpecial: false,
      showScenicLines: false,
    });
    assert.equal(resolveLayerPrefs(stored, "japan").showSpecial, true);
  });

  test("unreadable JSON is the defaults", () => {
    assert.deepEqual(parseStoredLayerPrefs("{not json"), {});
    assert.deepEqual(parseStoredLayerPrefs("null"), {});
  });

  test("the old one-for-every-region Special switch is kept for Europe alone", () => {
    const stored = parseStoredLayerPrefs(JSON.stringify({ showSpecial: false }));
    assert.equal(resolveLayerPrefs(stored, "europe").showSpecial, false);
    assert.equal(resolveLayerPrefs(stored, "japan").showSpecial, true);

    const on = parseStoredLayerPrefs(JSON.stringify({ showSpecial: true }));
    assert.equal(resolveLayerPrefs(on, "europe").showSpecial, true);
  });

  test("the legacy combined toggle seeds heritage and Europe's Special", () => {
    const stored = parseStoredLayerPrefs(JSON.stringify({ showSpecialLines: true }));
    const europe = resolveLayerPrefs(stored, "europe");
    assert.equal(europe.showHeritage, true);
    assert.equal(europe.showSpecial, true);
  });

  test("the legacy scenic key is carried over", () => {
    const stored = parseStoredLayerPrefs(JSON.stringify({ showScenicOutline: true }));
    assert.equal(resolveLayerPrefs(stored, "europe").showScenicLines, true);
  });

  test("Special is set per region, the others for every region", () => {
    let stored = withLayerPref({}, "japan", "showSpecial", false);
    stored = withLayerPref(stored, "japan", "showHeritage", true);
    assert.equal(resolveLayerPrefs(stored, "japan").showSpecial, false);
    assert.equal(resolveLayerPrefs(stored, "europe").showSpecial, false);
    assert.equal(resolveLayerPrefs(stored, "europe").showHeritage, true);

    stored = withLayerPref(stored, "europe", "showSpecial", true);
    assert.equal(resolveLayerPrefs(stored, "europe").showSpecial, true);
    assert.equal(resolveLayerPrefs(stored, "japan").showSpecial, false);
  });

  test("a stored form survives its own round trip, unknown regions dropped", () => {
    const stored = withLayerPref({}, "japan", "showSpecial", false);
    const json = JSON.stringify({
      ...stored,
      showSpecialByRegion: { ...stored.showSpecialByRegion, mars: true },
    });
    assert.deepEqual(parseStoredLayerPrefs(json).showSpecialByRegion, { japan: false });
  });

  test("Regular is switched per region, and only where it is not alone", () => {
    const stored = withLayerPref({}, "japan", "showRegular", false);
    assert.equal(resolveLayerPrefs(stored, "japan").showRegular, false);
    assert.equal(resolveLayerPrefs(stored, "europe").showRegular, true);

    // Europe has no switch for it, so a stored value cannot hide its map
    const europeOff = withLayerPref({}, "europe", "showRegular", false);
    assert.equal(resolveLayerPrefs(europeOff, "europe").showRegular, true);

    const json = JSON.stringify(stored);
    assert.deepEqual(parseStoredLayerPrefs(json).showRegularByRegion, { japan: false });
  });
});

describe("usage type filtering", () => {
  test("shown types follow all three switches", () => {
    assert.deepEqual(
      shownUsageTypes({ showRegular: true, showHeritage: false, showSpecial: true }),
      [0, 2],
    );
    assert.deepEqual(
      shownUsageTypes({ showRegular: false, showHeritage: false, showSpecial: false }),
      [],
    );
  });

  test("the click buffer filters nothing when all are shown, everything when none", () => {
    assert.equal(clickBufferFilter([0, 1, 2]), null);
    assert.equal(clickBufferFilter([]), false);
    assert.deepEqual(clickBufferFilter([2]), ["match", ["get", "usage_type"], [2], true, false]);
  });

  test("progress counts the ordinary types the map shows, and nothing else", () => {
    assert.deepEqual(countedUsageTypes("japan"), [0, 2]);
    assert.deepEqual(countedUsageTypes("japan", [2, 1]), [2]);
    assert.deepEqual(countedUsageTypes("japan", []), []);
    // Europe counts Regular only, whatever else is shown
    assert.deepEqual(countedUsageTypes("europe", [0, 1, 2]), [0]);
    // Not an array (a crafted server action call): everything the region counts
    assert.deepEqual(countedUsageTypes("japan", "2" as unknown as unknown[]), [0, 2]);
    // Nothing from the caller reaches the SQL
    assert.equal(
      ordinaryUsageSql("japan", "usage_type", ["0); DROP TABLE x; --", 2]),
      "usage_type IN (2)",
    );
    assert.equal(ordinaryUsageSql("japan", "usage_type", []), "FALSE");
  });
});
