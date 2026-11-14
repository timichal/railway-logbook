import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationError } from "@/lib/errors";
import { assertRegionId } from "@/lib/regionArgument";
import { REGION_IDS } from "@/lib/shared/regions";

test("every region id passes", () => {
  for (const id of REGION_IDS) assert.doesNotThrow(() => assertRegionId(id));
});

test("anything else is a ValidationError, not a TypeError further on", () => {
  for (const value of ["mars", "", "Europe", "constructor", "__proto__", undefined, null, 1, {}]) {
    assert.throws(() => assertRegionId(value), ValidationError);
  }
});
