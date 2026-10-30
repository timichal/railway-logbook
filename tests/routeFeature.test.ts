import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parsePgTextArray,
  parseTextArray,
  routeLinkLabel,
  routeTitle,
} from "@/lib/shared/map/routeFeature";

describe("parsePgTextArray", () => {
  test("an empty array", () => {
    assert.deepEqual(parsePgTextArray("{}"), []);
    assert.deepEqual(parsePgTextArray("{ }"), []);
  });

  test("unquoted elements, whitespace-trimmed", () => {
    assert.deepEqual(parsePgTextArray("{Daily,Weekends}"), ["Daily", "Weekends"]);
    assert.deepEqual(parsePgTextArray(" {Daily , Weekends} "), ["Daily", "Weekends"]);
  });

  test("a quoted element keeps its space and its comma", () => {
    assert.deepEqual(parsePgTextArray('{Daily,"Winter break"}'), ["Daily", "Winter break"]);
    assert.deepEqual(parsePgTextArray('{"Mon, Wed",Daily}'), ["Mon, Wed", "Daily"]);
    assert.deepEqual(parsePgTextArray('{" padded "}'), [" padded "]);
  });

  test("backslash escapes inside quotes", () => {
    assert.deepEqual(parsePgTextArray('{"say \\"hi\\"","back\\slash"}'), ['say "hi"', "backslash"]);
  });

  test("braces inside a quoted element", () => {
    assert.deepEqual(parsePgTextArray('{"{odd}",x}'), ["{odd}", "x"]);
  });

  test("an unquoted NULL is dropped, a quoted one is text", () => {
    assert.deepEqual(parsePgTextArray("{a,NULL,null,b}"), ["a", "b"]);
    assert.deepEqual(parsePgTextArray('{"NULL"}'), ["NULL"]);
  });

  test("anything that is not an array literal is nothing", () => {
    assert.deepEqual(parsePgTextArray(""), []);
    assert.deepEqual(parsePgTextArray("Daily"), []);
    assert.deepEqual(parsePgTextArray("[Daily]"), []);
  });
});

describe("parseTextArray", () => {
  test("reads the tile's array literal", () => {
    assert.deepEqual(parseTextArray('{Daily,"Winter break"}'), ["Daily", "Winter break"]);
  });

  test("takes the API's JSON array as it is, empty tags dropped", () => {
    assert.deepEqual(parseTextArray(["Daily", "", "Mon, Wed"]), ["Daily", "Mon, Wed"]);
  });

  test("nothing at all", () => {
    assert.deepEqual(parseTextArray(undefined), []);
    assert.deepEqual(parseTextArray(""), []);
    assert.deepEqual(parseTextArray('{""}'), []);
  });
});

describe("routeTitle", () => {
  const shared = {
    from_station: "Nagoya",
    to_station: "Kanayama",
    name: "Tokaido Main Line",
    other_names: '{"Chuo Main Line"}',
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
    assert.equal(routeTitle({ ...shared, other_names: "{}" }, "japan").alsoOn, null);
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
