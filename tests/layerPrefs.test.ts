import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parseStoredLayerPrefs,
  resolveLayerPrefs,
  withLayerPref,
} from "@/lib/shared/map/layerPrefs";

describe("layer prefs", () => {
  test("nothing stored: Special shown only where it is ordinary service", () => {
    const stored = parseStoredLayerPrefs(null);
    assert.deepEqual(resolveLayerPrefs(stored, "europe"), {
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
});
