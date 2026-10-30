import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { routeLink } from "@/lib/adminValidation";

describe("routeLink", () => {
  test("a link and its name, trimmed", () => {
    assert.deepEqual(routeLink(" https://ffestiniog.example ", " Ffestiniog Railway "), {
      link: "https://ffestiniog.example",
      linkName: "Ffestiniog Railway",
    });
  });

  test("a blank name is the default", () => {
    assert.deepEqual(routeLink("https://example.com", "  "), {
      link: "https://example.com",
      linkName: null,
    });
    assert.equal(routeLink("https://example.com", null).linkName, null);
  });

  test("no name without a link", () => {
    assert.deepEqual(routeLink("", "Ffestiniog Railway"), { link: null, linkName: null });
    assert.deepEqual(routeLink("   ", "Ffestiniog Railway"), { link: null, linkName: null });
    assert.deepEqual(routeLink(null, "Ffestiniog Railway"), { link: null, linkName: null });
  });
});
