import { describe, expect, it } from "vitest";
import { createQlooClient, type QlooClientOptions } from "@/lib/qloo/client";
import { createMemoryCache } from "@/lib/qloo/cache";
import { QlooCacheMissError } from "@/lib/qloo/errors";
import { ENV, fakeFetch, id, searchItem, type FakeResponse } from "@/lib/qloo/testing";
import { FIELDS } from "@/types";
import { FIELD_SEARCH_TYPE } from "./field-types";
import { placesLocation, SeedConfigError } from "./places";
import { cleanQuery, nameKey, resolveSeed } from "./resolve";

type Respond = Parameters<typeof fakeFetch>[0];

const item = (n: number, name: string, extra: Record<string, unknown> = {}) => searchItem(n, { name, ...extra });
const ok = (items: unknown[]): FakeResponse => ({ body: { success: true, duration: 5, results: items } });

function setup(respond: Respond, opts: Partial<QlooClientOptions> = {}) {
  const f = fakeFetch(respond);
  const cache = createMemoryCache();
  const client = () =>
    createQlooClient({ mode: "record", cache, fetch: f.fetch, env: () => ENV, sleep: async () => {}, limits: { MIN_REQUEST_INTERVAL_MS: 0 }, ...opts });
  return { client, calls: f.calls, cache };
}

describe("resolveSeed statuses", () => {
  it("clean: exactly one exact-name match, with the other results ignored", async () => {
    const { client } = setup(() => ok([item(1, "Invented Title"), item(2, "Invented Title Two"), item(3, "Another Invented")]));
    const r = await resolveSeed(client(), { field: "film", query: "invented title" });
    expect(r.status).toBe("clean");
    if (r.status !== "clean") return;
    expect(r.entity.qlooId).toBe(id(1));
    expect(r.entity.name).toBe("Invented Title");
    expect(r.candidates).toEqual([]);
  });

  it("clean: match ignores case, accents, punctuation and a leading article", async () => {
    const { client } = setup(() => ok([item(1, "The Invented Café!")]));
    const r = await resolveSeed(client(), { field: "film", query: "invented cafe" });
    expect(r.status).toBe("clean");
  });

  it("ambiguous: several exact-name matches, exact ones first, with year or disambiguation in the label", async () => {
    const { client } = setup(() =>
      ok([
        item(1, "Invented Sequel"),
        item(2, "Invented Title", { disambiguation: "2001 film", properties: { release_year: 2001 } }),
        item(3, "Invented Title", { disambiguation: "remake", properties: { release_date: "2019-05-01" } }),
      ]),
    );
    const r = await resolveSeed(client(), { field: "film", query: "Invented Title" });
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.candidates.map((c) => c.qlooId)).toEqual([id(2), id(3), id(1)]);
    expect(r.candidates[0].label).toBe("Invented Title (2001, 2001 film)");
    expect(r.candidates[1].year).toBe(2019);
  });

  it("ambiguous: no exact match but results, capped at 5 candidates", async () => {
    const { client } = setup(() => ok([1, 2, 3, 4, 5, 6, 7].map((n) => item(n, `Invented Near ${n}`))));
    const r = await resolveSeed(client(), { field: "film", query: "Invented Nearby" });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(5);
  });

  it("ambiguous: the same entity returned twice is one candidate, not two exact matches", async () => {
    const { client } = setup(() => ok([item(1, "Invented Title"), item(1, "Invented Title")]));
    const r = await resolveSeed(client(), { field: "film", query: "Invented Title" });
    expect(r.status).toBe("clean");
  });

  it("missing: an empty 200", async () => {
    const { client } = setup(() => ok([]));
    expect(await resolveSeed(client(), { field: "books", query: "zzqx nothing" })).toEqual({ status: "missing", candidates: [] });
  });

  it("missing: the 404 'No results' shape the client reports as empty", async () => {
    const { client } = setup(() => ({ status: 404, body: { code: 404, reason: "Not Found", message: "No results" } }));
    expect(await resolveSeed(client(), { field: "books", query: "zzqx nothing" })).toEqual({ status: "missing", candidates: [] });
  });

  it("missing: results that are all of another type or unusable", async () => {
    const { client } = setup(() => ok([item(1, "Invented Title", { types: ["urn:entity:book"] }), { entity_id: id(2) }]));
    expect(await resolveSeed(client(), { field: "film", query: "Invented Title" })).toEqual({ status: "missing", candidates: [] });
  });
});

describe("the search call", () => {
  it("maps every field to its entity type, takes at most 10, and makes one call", async () => {
    for (const field of FIELDS) {
      const { client, calls } = setup(() => ok([item(1, "Invented Title")]));
      await resolveSeed(client(), { field, query: "Invented Title" });
      expect(calls).toHaveLength(1);
      expect(calls[0].url.pathname).toBe("/search");
      expect(calls[0].url.searchParams.get("types")).toBe(FIELD_SEARCH_TYPE[field]);
      expect(Number(calls[0].url.searchParams.get("take"))).toBeLessThanOrEqual(10);
    }
  });

  it("uses the agreed types", () => {
    expect(FIELD_SEARCH_TYPE).toEqual({
      music: "urn:entity:artist",
      film: "urn:entity:movie",
      tv: "urn:entity:tv_show",
      books: "urn:entity:book",
      food_places: "urn:entity:place",
      fashion: "urn:entity:brand",
    });
  });

  it("adds the default city and radius for places only", async () => {
    const places = setup(() => ok([item(1, "Invented Diner", { types: ["urn:entity:place"] })]));
    await resolveSeed(places.client(), { field: "food_places", query: "Invented Diner" }, {});
    const p = places.calls[0].url.searchParams;
    expect(p.get("filter.location")).toBe("40.7128,-74.006");
    expect(p.get("filter.radius")).toBe("20");

    const other = setup(() => ok([item(1, "Invented Label", { types: ["urn:entity:brand"] })]));
    await resolveSeed(other.client(), { field: "fashion", query: "Invented Label" }, {});
    expect(other.calls[0].url.searchParams.has("filter.location")).toBe(false);
    expect(other.calls[0].url.searchParams.has("filter.radius")).toBe(false);
  });

  it("takes the places city and radius from env", async () => {
    const { client, calls } = setup(() => ok([item(1, "Invented Diner", { types: ["urn:entity:place"] })]));
    await resolveSeed(client(), { field: "food_places", query: "Invented Diner" }, { ATELIER_PLACES_LOCATION: "41.8781, -87.6298", ATELIER_PLACES_RADIUS: "35" });
    expect(calls[0].url.searchParams.get("filter.location")).toBe("41.8781,-87.6298");
    expect(calls[0].url.searchParams.get("filter.radius")).toBe("35");
  });

  it("rejects a malformed places env", () => {
    expect(() => placesLocation({ ATELIER_PLACES_LOCATION: "New York" })).toThrow(SeedConfigError);
    expect(() => placesLocation({ ATELIER_PLACES_LOCATION: "95,10" })).toThrow(SeedConfigError);
    expect(() => placesLocation({ ATELIER_PLACES_RADIUS: "0" })).toThrow(SeedConfigError);
    expect(() => placesLocation({ ATELIER_PLACES_RADIUS: "500" })).toThrow(SeedConfigError);
    expect(placesLocation({})).toEqual({ location: "40.7128,-74.006", radius: 20 });
  });

  it("a repeated query makes 0 live calls (whitespace and case do not matter)", async () => {
    const { client, calls } = setup(() => ok([item(1, "Invented Title")]));
    const first = client();
    await resolveSeed(first, { field: "film", query: "Invented Title" });
    expect(first.stats().liveCalls).toBe(1);
    const again = client();
    const r = await resolveSeed(again, { field: "film", query: "  invented   TITLE " });
    expect(r.status).toBe("clean");
    expect(again.stats().liveCalls).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("replay mode with a cold cache throws a cache miss and sends nothing", async () => {
    const { client, calls } = setup(() => ok([]), { mode: "replay" });
    await expect(resolveSeed(client(), { field: "film", query: "Invented Title" })).rejects.toBeInstanceOf(QlooCacheMissError);
    expect(calls).toHaveLength(0);
  });
});

describe("chips", () => {
  it("carry only the chip fields, never raw Qloo JSON", async () => {
    const { client } = setup(() =>
      ok([
        item(1, "Invented Title", {
          disambiguation: "synthetic",
          properties: { release_year: 1999, image: { url: "https://images.example.test/a.jpg" }, external: { wikidata: [{ id: "Q1" }] }, description: "long text" },
        }),
      ]),
    );
    const r = await resolveSeed(client(), { field: "film", query: "Invented Title" });
    if (r.status !== "clean") throw new Error("expected clean");
    expect(r.entity).toEqual({
      qlooId: id(1),
      name: "Invented Title",
      type: "movie",
      label: "Invented Title (1999, synthetic)",
      year: 1999,
      disambiguation: "synthetic",
      imageUrl: "https://images.example.test/a.jpg",
    });
    expect(JSON.stringify(r)).not.toMatch(/wikidata|long text|tags|popularity|properties/);
  });

  it("drops non-https images and implausible years", async () => {
    const { client } = setup(() => ok([item(1, "Invented Title", { disambiguation: "", properties: { release_year: "n/a", image: "http://insecure.example.test/a.jpg" } })]));
    const r = await resolveSeed(client(), { field: "film", query: "Invented Title" });
    if (r.status !== "clean") throw new Error("expected clean");
    expect(r.entity.imageUrl).toBeUndefined();
    expect(r.entity.year).toBeUndefined();
    expect(r.entity.label).toBe("Invented Title");
  });
});

describe("name helpers", () => {
  it("normalizes names and queries", () => {
    expect(nameKey("The Invented  Café & Co.")).toBe("invented cafe and co");
    expect(nameKey("The")).toBe("the");
    expect(cleanQuery("  a   b\t c ")).toBe("a b c");
  });
});
