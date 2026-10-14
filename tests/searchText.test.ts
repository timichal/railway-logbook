import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { foldForSearch } from "@/lib/searchText";

describe("foldForSearch", () => {
  test("drops case and combining diacritics", () => {
    assert.equal(foldForSearch("Chūō Main Line"), "chuo main line");
    assert.equal(foldForSearch("Tōkaidō"), "tokaido");
    assert.equal(foldForSearch("Břeclav"), "breclav");
    assert.equal(foldForSearch("Ōmiya"), "omiya");
  });

  test("letters NFD leaves whole", () => {
    assert.equal(foldForSearch("Łódź"), "lodz");
    assert.equal(foldForSearch("Køge"), "koge");
    assert.equal(foldForSearch("Straße"), "strasse");
    assert.equal(foldForSearch("Kırıkkale"), "kirikkale");
    assert.equal(foldForSearch("Þingvellir"), "thingvellir");
    assert.equal(foldForSearch("Đakovo"), "dakovo");
    assert.equal(foldForSearch("İzmir"), "izmir");
  });

  test("a folded query finds the original", () => {
    assert.ok(foldForSearch("Chūō Main Line").includes(foldForSearch("chuo")));
  });
});
