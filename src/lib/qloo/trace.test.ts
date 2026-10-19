import { describe, expect, it } from "vitest";
import { redactParams } from "./trace";
import { id, tagId } from "./testing";

describe("redactParams", () => {
  it("never keeps a raw value under an id key", () => {
    const out = redactParams({
      "signal.interests.entities": [{ id: id(1), weight: 1 }, { id: id(2), weight: 1 }],
      "filter.exclude.entities": [id(3)],
      "filter.tags": [tagId(1), tagId(2), tagId(3)],
      "filter.results.entities": id(4), // a scalar where a list is expected
      "signal.interests.tags": { id: id(5) } as unknown as string[],
      entity_ids: [id(6), id(7)],
      "external.imdb.ids": ["tt0000001"],
      "filter.exclude.tags": tagId(9),
    });
    expect(out).toEqual({
      "signal.interests.entities": "[2 ids]",
      "filter.exclude.entities": "[1 ids]",
      "filter.tags": "[3 ids]",
      "filter.results.entities": "[id]",
      "signal.interests.tags": "[ids]",
      entity_ids: "[2 ids]",
      "external.imdb.ids": "[1 ids]",
      "filter.exclude.tags": "[id]",
    });
    expect(JSON.stringify(out)).not.toMatch(/00000000-0000|urn:tag|tt0000001/);
  });

  it("also masks id-shaped values under other keys, and keeps plain values", () => {
    const out = redactParams({ "filter.location": id(1), "filter.parents.types": ["urn:entity:movie"], query: "an invented title", take: 20, "feature.explainability": true, "filter.popularity.max": 0.6 });
    expect(out).toEqual({ "filter.location": "[id]", "filter.parents.types": ["urn:entity:movie"], query: "an invented title", take: 20, "feature.explainability": true, "filter.popularity.max": 0.6 });
  });
});
