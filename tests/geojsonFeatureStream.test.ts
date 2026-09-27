import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createFeatureStreamStats,
  describeFeatureStream,
  type FeatureStreamStats,
  streamFeatures,
} from "@/scripts/lib/geojsonFeatureStream";

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
}

const feature = (properties: Record<string, unknown>): Feature => ({
  type: "Feature",
  properties,
});

async function* chunked(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

async function read(
  text: string,
  chunkSize = text.length || 1,
): Promise<{ features: Feature[]; stats: FeatureStreamStats }> {
  const stats = createFeatureStreamStats();
  const features: Feature[] = [];
  for await (const f of streamFeatures<Feature>(chunked(text, chunkSize), stats)) {
    features.push(f);
  }
  return { features, stats };
}

/** Laid out as `osmium export` writes it: compact, one feature per line. */
const collection = (features: Feature[]) =>
  `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`;

const tricky = [
  feature({ name: "Plain" }),
  feature({ note: "unmatched } brace" }),
  feature({ note: "unmatched { brace" }),
  feature({ name: 'quote \\" and {braces}', ref: "\\" }),
  feature({ nested: { deep: [{ a: 1 }] } }),
];

describe("streamFeatures", () => {
  test("reads a complete collection", async () => {
    const { features, stats } = await read(collection(tricky));
    assert.deepEqual(features, tricky);
    assert.deepEqual(stats, { total: 5, malformed: 0, truncated: false });
  });

  test("the result does not depend on where the chunks are cut", async () => {
    const text = collection(tricky);
    for (const size of [1, 2, 3, 7, 16]) {
      const { features, stats } = await read(text, size);
      assert.deepEqual(features, tricky, `chunk size ${size}`);
      assert.equal(stats.truncated, false, `chunk size ${size}`);
    }
  });

  test("an empty features array", async () => {
    const { features, stats } = await read('{"type":"FeatureCollection","features":[]}');
    assert.deepEqual(features, []);
    assert.deepEqual(stats, { total: 0, malformed: 0, truncated: false });
  });

  test("input cut right after a feature's `},` reads as truncated", async () => {
    const text = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{}},';
    const { features, stats } = await read(text);
    assert.equal(features.length, 1);
    assert.equal(stats.truncated, true);
  });

  test("input cut right after a feature's `}` reads as truncated", async () => {
    const text = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{}}';
    const { stats } = await read(text);
    assert.equal(stats.truncated, true);
  });

  test("input cut mid-feature keeps the features before it", async () => {
    const full = collection(tricky);
    const cut = full.slice(0, full.indexOf("unmatched { brace") + 5);
    const { features, stats } = await read(cut, 4);
    assert.deepEqual(features, tricky.slice(0, 2));
    assert.equal(stats.truncated, true);
  });

  test("a feature that does not parse is counted, and the rest still read", async () => {
    const text = '{"features":[{"a":1},{"b":},{"c":3}]}';
    const stats = createFeatureStreamStats();
    const features: unknown[] = [];
    for await (const f of streamFeatures(chunked(text, 5), stats)) features.push(f);
    assert.deepEqual(features, [{ a: 1 }, { c: 3 }]);
    assert.deepEqual(stats, { total: 3, malformed: 1, truncated: false });
  });

  test("anything but a comma between features is refused", async () => {
    await assert.rejects(read('{"features":[{"a":1} x {"b":2}]}'), /between features/);
  });

  test("input with no features array is refused", async () => {
    await assert.rejects(read('{"type":"FeatureCollection"}'), /ended before/);
    await assert.rejects(read(""), /ended before/);
  });
});

describe("describeFeatureStream", () => {
  test("mentions only what went wrong", () => {
    assert.equal(
      describeFeatureStream({ total: 3, malformed: 0, truncated: false }),
      "3 features read",
    );
    assert.equal(
      describeFeatureStream({ total: 3, malformed: 1, truncated: true }),
      "3 features read, 1 MALFORMED (skipped), input TRUNCATED",
    );
  });
});
