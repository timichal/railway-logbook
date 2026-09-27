import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeCountryCodes } from "@/lib/shared/constants";

describe("normalizeCountryCodes", () => {
  test("upper-cases and trims", () => {
    assert.deepEqual(normalizeCountryCodes(["cz", " at ", "De"]), ["CZ", "AT", "DE"]);
  });

  test("drops duplicates, keeping the first occurrence's place", () => {
    assert.deepEqual(normalizeCountryCodes(["CZ", "AT", "cz", "AT "]), ["CZ", "AT"]);
  });

  test("keeps only two-letter codes", () => {
    assert.deepEqual(normalizeCountryCodes(["CZE", "C", "", "1A", "C-", "SK"]), ["SK"]);
  });

  test("ignores whatever is not a string", () => {
    const codes = ["CZ", 42, null, undefined, { code: "AT" }] as unknown as string[];
    assert.deepEqual(normalizeCountryCodes(codes), ["CZ"]);
  });

  test("does not prune codes outside the supported list", () => {
    assert.deepEqual(normalizeCountryCodes(["XX", "JP"]), ["XX", "JP"]);
  });
});
