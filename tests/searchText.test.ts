import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { filterByName, foldAccents, foldForSearch } from "@/lib/shared/searchText";

describe("foldForSearch", () => {
  test("drops case and combining diacritics", () => {
    assert.equal(foldForSearch("Chūō"), "chuo");
    assert.equal(foldForSearch("Tōkaidō"), "tokaido");
    assert.equal(foldForSearch("Břeclav"), "breclav");
    assert.equal(foldForSearch("Ōmiya"), "omiya");
  });

  test("drops the separators operators spell differently", () => {
    assert.equal(foldForSearch("Owari Seto"), "owariseto");
    assert.equal(foldForSearch("Owari-Seto"), "owariseto");
    assert.equal(foldForSearch("San'yō Main Line"), "sanyomainline");
    assert.equal(foldForSearch("San’yō"), "sanyo");
    assert.equal(foldForSearch("Honshi–Bisan Line"), "honshibisanline");
    assert.equal(foldForSearch("Haneda Airport Terminal 1・2"), "hanedaairportterminal12");
    assert.equal(foldForSearch("Narita Airport Terminal 2·3"), "naritaairportterminal23");
    assert.equal(
      foldForSearch("Shimin Hiroba (Convention Center)"),
      "shiminhiroba(conventioncenter)",
    );
  });

  test("keeps the kana voicing marks, folds full-width forms", () => {
    assert.equal(foldForSearch("あざみの"), "あざみの");
    assert.equal(foldForSearch("ボート"), "ボート");
    assert.equal(foldForSearch("３階のりば"), "3階のりば");
    assert.equal(foldForSearch("№19"), "no19");
  });

  test("foldAccents keeps the separators", () => {
    assert.equal(foldAccents("1-2x Daily"), "1-2x daily");
    assert.equal(foldAccents("Chūō Main Line"), "chuo main line");
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
    assert.ok(foldForSearch("Owari-Seto").includes(foldForSearch("owari se")));
  });
});

describe("filterByName", () => {
  const trips = [
    { id: 1, name: "Japan spring 2025" },
    { id: 2, name: "Balkány – léto" },
    { id: 3, name: "Tōhoku rail pass" },
  ];
  const ids = (query: string) => filterByName(trips, query).map((trip) => trip.id);

  test("keeps everything, in order, for an empty query", () => {
    assert.deepEqual(ids(""), [1, 2, 3]);
    assert.deepEqual(ids("  - "), [1, 2, 3]);
  });

  test("needs every word, anywhere and in any order", () => {
    assert.deepEqual(ids("2025 japan"), [1]);
    assert.deepEqual(ids("pan spr"), [1]);
    assert.deepEqual(ids("japan 2024"), []);
  });

  test("folds case and diacritics", () => {
    assert.deepEqual(ids("balkany leto"), [2]);
    assert.deepEqual(ids("TOHOKU"), [3]);
  });
});
