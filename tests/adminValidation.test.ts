import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { routeClosure, routeLink } from "@/lib/adminValidation";
import { ValidationError } from "@/lib/errors";

describe("routeClosure", () => {
  test("a closed route, with or without its day", () => {
    assert.deepEqual(routeClosure(true, " 2024-12-15 "), { closed: true, closedOn: "2024-12-15" });
    assert.deepEqual(routeClosure(true, ""), { closed: true, closedOn: null });
    assert.deepEqual(routeClosure(true, null), { closed: true, closedOn: null });
  });

  test("the day goes with the flag", () => {
    assert.deepEqual(routeClosure(false, "2024-12-15"), { closed: false, closedOn: null });
  });

  test("anything but a real day is refused", () => {
    assert.throws(() => routeClosure(true, "2024-02-31"), ValidationError);
    assert.throws(() => routeClosure(true, "15.12.2024"), ValidationError);
    assert.throws(() => routeClosure("yes", null), ValidationError);
    // Not a string at all: refused even beside an unticked box, never dropped quietly
    assert.throws(() => routeClosure(true, 20241215), ValidationError);
    assert.throws(() => routeClosure(false, {}), ValidationError);
  });
});

describe("routeLink", () => {
  test("a link and its name, trimmed", () => {
    assert.deepEqual(routeLink(" https://ffestiniog.example ", " Ffestiniog Railway "), {
      link: "https://ffestiniog.example",
      linkName: "Ffestiniog Railway",
    });
  });

  test("a link needs a name", () => {
    assert.throws(() => routeLink("https://example.com", "  "), ValidationError);
    assert.throws(() => routeLink("https://example.com", ""), ValidationError);
    assert.throws(() => routeLink("https://example.com", null), ValidationError);
  });

  test("no name without a link", () => {
    assert.deepEqual(routeLink("", "Ffestiniog Railway"), { link: null, linkName: null });
    assert.deepEqual(routeLink("   ", "Ffestiniog Railway"), { link: null, linkName: null });
    assert.deepEqual(routeLink(null, "Ffestiniog Railway"), { link: null, linkName: null });
  });
});
