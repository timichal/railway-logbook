import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseFrequencyTags, parsePgTextArray } from "@/lib/shared/map/routeFeature";

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

describe("parseFrequencyTags", () => {
  test("reads the tile's array literal", () => {
    assert.deepEqual(parseFrequencyTags('{Daily,"Winter break"}'), ["Daily", "Winter break"]);
  });

  test("takes the API's JSON array as it is, empty tags dropped", () => {
    assert.deepEqual(parseFrequencyTags(["Daily", "", "Mon, Wed"]), ["Daily", "Mon, Wed"]);
  });

  test("nothing at all", () => {
    assert.deepEqual(parseFrequencyTags(undefined), []);
    assert.deepEqual(parseFrequencyTags(""), []);
    assert.deepEqual(parseFrequencyTags('{""}'), []);
  });
});
