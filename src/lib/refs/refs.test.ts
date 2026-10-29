import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryCache,
  createRefsContext,
  getReferences,
  isRealContact,
  lineageTouchingSeeds,
  nameMatchKey,
  refsTraceFields,
  resetSharedBlock,
} from "./index";
import { LICENSES, QLOO_SOURCE_URL } from "./limits";
import { excerpt, readingFor } from "./reading";
import { entity, fakeWikidata, status, synthetic } from "./testing";
import { buildUserAgent, createWikidataClient, parseRetryAfter } from "./wikidata";

afterEach(() => {
  vi.unstubAllEnvs();
  resetSharedBlock();
});

const CONTACT = "test@example.invalid";
const fresh = () => ({ cache: createMemoryCache(), block: { until: 0 }, contact: CONTACT });

const ctxWith = (fake: ReturnType<typeof fakeWikidata>, extra = {}) =>
  createRefsContext({ fetch: fake.fetch, ...fresh(), ...extra });

/** n synthetic films, each with one P737 parent that has a label. */
function manyItemsFor(n: number) {
  const items: Record<string, { claims?: Record<string, { id: string }[]>; label?: string }> = {};
  for (let i = 0; i < n; i++) {
    items[`Q${9200 + i}`] = { claims: { P737: [{ id: `Q${9300 + i}` }] } };
    items[`Q${9300 + i}`] = { label: `Fixture Parent ${i}` };
  }
  return items;
}

const WD = {
  Q9001: {
    claims: { P737: [{ id: "Q9101" }, { id: "Q9102" }], P144: [{ id: "Q9103" }] },
  },
  Q9101: { label: "Fixture Predecessor One" },
  Q9102: { label: "Fixture Predecessor Two" },
  Q9103: { label: "Fixture Source Work" },
};

describe("sourced hops", () => {
  it("music: Qloo influence fields only, no Wikidata call", async () => {
    const fake = fakeWikidata({});
    const ctx = ctxWith(fake);
    const refs = await getReferences(
      entity(1, "music", {
        properties: {
          influenced_by: ["Fixture Elder", { name: "Fixture Peer" }],
          artists_influenced: ["Fixture Younger"],
          genres_influenced: ["Fixture Genre"],
          wikidata_id: "Q9001",
        },
      }),
      ctx,
    );
    expect(refs.lineage.map((l) => l.relation)).toEqual(["influenced_by", "influenced", "genres_influenced"]);
    expect(refs.lineage[0].hop.label).toBe("Influenced by Fixture Elder and Fixture Peer");
    expect(refs.lineage[0].license).toBe(LICENSES.qloo);
    expect(refs.lineage[0].sourceLabel).toBe("Qloo");
    expect(refs.reading).toBeUndefined();
    expect(refs.wikidata).toBe("not_applicable");
    expect(fake.calls).toHaveLength(0);
  });

  it("film: Qloo hop plus Wikidata hops, 2 requests, then a cached repeat makes none", async () => {
    const fake = fakeWikidata(WD);
    const ctx = ctxWith(fake);
    const e = entity(2, "film", { properties: { influenced_other_media: ["Fixture Echo"], wikidata_id: "Q9001" } });
    const refs = await getReferences(e, ctx);
    expect(refs.lineage.map((l) => [l.source, l.relation])).toEqual([
      ["qloo", "influenced_other_media"],
      ["wikidata", "based_on"],
      ["wikidata", "influenced_by"],
    ]);
    const wd = refs.lineage.find((l) => l.relation === "influenced_by")!;
    expect(wd.names).toEqual(["Fixture Predecessor One", "Fixture Predecessor Two"]);
    expect(wd.hop.sourceUrl).toBe("https://www.wikidata.org/wiki/Q9001");
    expect(wd.license).toBe(LICENSES.wikidata);
    expect(refs.wikidata).toBe("ok");
    expect(fake.calls.map((c) => c.props)).toEqual(["claims", "labels"]);
    expect(new Set(fake.calls[1].ids)).toEqual(new Set(["Q9101", "Q9102", "Q9103"]));

    const again = await getReferences(e, ctx);
    expect(again.wikidata).toBe("cached");
    expect(again.lineage).toEqual(refs.lineage);
    expect(fake.calls).toHaveLength(2);
  });

  it("reads the id from external.wikidata[].id too", async () => {
    const fake = fakeWikidata(WD);
    const refs = await getReferences(entity(3, "tv", { external: { wikidata: [{ id: "Q9001" }] } }), ctxWith(fake));
    expect(refs.lineage.length).toBeGreaterThan(0);
    expect(refs.lineage.every((l) => l.source === "wikidata")).toBe(true);
  });

  it("fashion: similar_brands plus Wikidata influence", async () => {
    const fake = fakeWikidata({ Q9002: { claims: { P737: [{ id: "Q9104" }] } }, Q9104: { label: "Fixture House" } });
    const refs = await getReferences(
      entity(4, "fashion", { properties: { similar_brands: ["Fixture Label"], wikidata_id: "Q9002" } }),
      ctxWith(fake),
    );
    expect(refs.lineage.map((l) => l.hop.label)).toEqual([
      "Listed as a similar brand to Fixture Label",
      "Influenced by Fixture House",
    ]);
  });

  it("every hop is sourced, has a link and a license, and kinds are lineage", async () => {
    const fake = fakeWikidata(WD);
    const refs = await getReferences(
      entity(5, "film", { properties: { influenced_other_media: ["Fixture Echo"], wikidata_id: "Q9001" } }),
      ctxWith(fake),
    );
    for (const l of refs.lineage) {
      expect(l.hop.kind).toBe("lineage");
      expect(l.hop.provenance).toBe("sourced");
      expect(l.hop.sourceUrl).toMatch(/^https:\/\//);
      expect(l.license.length).toBeGreaterThan(0);
    }
    expect(refs.sourceUrls).toEqual([QLOO_SOURCE_URL, "https://www.wikidata.org/wiki/Q9001"]);
  });

  it("caps related names per hop and skips self and duplicates", async () => {
    const refs = await getReferences(
      entity(6, "music", {
        name: "Fixture Self",
        properties: { influenced_by: ["Fixture Self", "A One", "a one", "B Two", "C Three", "D Four"] },
      }),
      ctxWith(fakeWikidata({})),
    );
    expect(refs.lineage[0].names).toEqual(["A One", "B Two", "C Three"]);
  });
});

describe("empty cases", () => {
  it("returns nothing when nothing is retrieved, in every field", async () => {
    const fake = fakeWikidata({});
    const ctx = ctxWith(fake);
    for (const [i, f] of (["music", "film", "tv", "books", "food_places", "fashion"] as const).entries()) {
      const refs = await getReferences(entity(10 + i, f, { properties: {} }), ctx);
      expect(refs.lineage).toEqual([]);
      expect(refs.reading).toBeUndefined();
      expect(refs.sourceUrls).toEqual([]);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("an entity with no properties at all is fine", async () => {
    const refs = await getReferences(entity(20, "film"), ctxWith(fakeWikidata({})));
    expect(refs).toMatchObject({ lineage: [], wikidata: "no_id" });
  });

  it("books and places return no lineage and no reading even with lineage-shaped data and a Wikidata id", async () => {
    const fake = fakeWikidata(WD);
    const ctx = ctxWith(fake);
    const props = {
      influenced_by: ["Fixture Elder"],
      influenced_other_media: ["Fixture Echo"],
      similar_brands: ["Fixture Label"],
      biography: "A long enough passage of text that would qualify as a reading elsewhere in the product.",
      wikidata_id: "Q9001",
    };
    for (const f of ["books", "food_places"] as const) {
      const refs = await getReferences(entity(21, f, { properties: props }), ctx);
      expect(refs).toMatchObject({ lineage: [], wikidata: "not_applicable" });
      expect(refs.reading).toBeUndefined();
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("Wikidata finds no relation: ok with nothing, one request", async () => {
    const fake = fakeWikidata({ Q9003: { claims: {} } });
    const refs = await getReferences(entity(22, "film", { properties: { wikidata_id: "Q9003" } }), ctxWith(fake));
    expect(refs).toMatchObject({ lineage: [], wikidata: "ok" });
    expect(fake.calls).toHaveLength(1);
  });

  it("drops a related item with no English label, and deprecated or non-item claims", async () => {
    const fake = fakeWikidata({
      Q9004: {
        claims: {
          P737: [
            { id: "Q9110" },
            { id: "Q9111" },
            { id: "Q9112", rank: "deprecated" },
            { id: "Q9113", snaktype: "somevalue" },
          ],
        },
      },
      Q9110: { label: "Fixture Labeled" },
      Q9111: {},
    });
    const refs = await getReferences(entity(23, "film", { properties: { wikidata_id: "Q9004" } }), ctxWith(fake));
    expect(refs.lineage.map((l) => l.names)).toEqual([["Fixture Labeled"]]);
  });
});

describe("Wikidata budget, cache and failures", () => {
  const manyItems = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`Q${9200 + i}`, { claims: { P737: [{ id: `Q${9300 + i}` }] } }]).concat(
      Array.from({ length: 8 }, (_, i) => [`Q${9300 + i}`, { label: `Fixture Parent ${i}` }] as never),
    ),
  );

  it("looks up at most 6 finalists per run, even when called concurrently", async () => {
    const fake = fakeWikidata(manyItems);
    const ctx = ctxWith(fake);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        getReferences(entity(30 + i, "film", { properties: { wikidata_id: `Q${9200 + i}` } }), ctx),
      ),
    );
    expect(results.filter((r) => r.wikidata === "ok")).toHaveLength(6);
    expect(results.filter((r) => r.wikidata === "budget_exhausted")).toHaveLength(2);
    expect(ctx.wikidata.lookups).toBe(6);
    expect(ctx.wikidata.requests).toBe(12);
    expect(results.slice(6).every((r) => r.lineage.length === 0)).toBe(true);
  });

  it("cache hits across runs do not use the budget", async () => {
    const fake = fakeWikidata(manyItems);
    const cache = createMemoryCache();
    const run1 = createRefsContext({ fetch: fake.fetch, cache, block: { until: 0 }, contact: CONTACT });
    await getReferences(entity(40, "film", { properties: { wikidata_id: "Q9200" } }), run1);
    const before = fake.calls.length;
    const run2 = createRefsContext({ fetch: fake.fetch, cache, block: { until: 0 }, contact: CONTACT });
    const refs = await getReferences(entity(40, "film", { properties: { wikidata_id: "Q9200" } }), run2);
    expect(refs.wikidata).toBe("cached");
    expect(run2.wikidata.lookups).toBe(0);
    expect(fake.calls).toHaveLength(before);
  });

  it("the cache expires after its TTL", async () => {
    let t = 0;
    const cache = createMemoryCache(() => t);
    cache.set("k", [], 100);
    expect(cache.get("k")).toEqual([]);
    t = 101;
    expect(cache.get("k")).toBeUndefined();
  });

  it("a 429 returns nothing and stops later requests in the run", async () => {
    const fake = fakeWikidata(manyItems, () => status(429));
    const ctx = ctxWith(fake);
    const a = await getReferences(entity(41, "film", { properties: { wikidata_id: "Q9200" } }), ctx);
    const b = await getReferences(entity(42, "film", { properties: { wikidata_id: "Q9201" } }), ctx);
    expect([a.wikidata, b.wikidata]).toEqual(["unavailable", "unavailable"]);
    expect(a.lineage).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it("a thrown fetch, an error body and a bad body are all unavailable, and are not cached", async () => {
    const cache = createMemoryCache();
    const bodies: (() => never | Promise<never> | { ok: true; status: 200; json: () => Promise<unknown> })[] = [
      () => {
        throw new Error("network down");
      },
      () => ({ ok: true, status: 200, json: async () => ({ error: { code: "maxlag" } }) }),
      () => ({ ok: true, status: 200, json: async () => "not an object" }),
    ];
    for (const [i, make] of bodies.entries()) {
      const fake = fakeWikidata({}, () => make() as never);
      const ctx = createRefsContext({ fetch: fake.fetch, cache, block: { until: 0 }, contact: CONTACT });
      const r = await getReferences(entity(50 + i, "film", { properties: { wikidata_id: "Q9200" } }), ctx);
      expect(r.wikidata).toBe("unavailable");
    }
    expect(cache.get("lineage:film:Q9200")).toBeUndefined();
  });

  it("times out a request that never answers", async () => {
    const never: typeof fetch = () => new Promise(() => {});
    const client = createWikidataClient({
      fetch: never as never,
      ...fresh(),
      limits: { WIKIDATA_TIMEOUT_MS: 20 },
    });
    expect((await client.lookup("Q9200", "film")).status).toBe("unavailable");
    // A timeout blocks the rest of the run: the next finalist makes no request.
    expect((await client.lookup("Q9201", "film")).status).toBe("unavailable");
    expect(client.requests).toBe(1);
  });

  it("rejects an id that is not a Wikidata item id without calling out", async () => {
    const fake = fakeWikidata({});
    const client = createWikidataClient({ fetch: fake.fetch, ...fresh() });
    expect((await client.lookup("Q1|Q2", "film")).status).toBe("no_id");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("User-Agent and contact", () => {
  it("is descriptive, carries the contact, and is sent on every request", async () => {
    const fake = fakeWikidata(WD);
    await getReferences(entity(60, "film", { properties: { wikidata_id: "Q9001" } }), ctxWith(fake));
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const c of fake.calls) {
      expect(c.headers["User-Agent"]).toBe("AtelierHackathonDemo/0.1 (test@example.invalid)");
    }
  });

  it("sends maxlag=5 on every request", async () => {
    const fake = fakeWikidata(WD);
    await getReferences(entity(61, "film", { properties: { wikidata_id: "Q9001" } }), ctxWith(fake));
    for (const c of fake.calls) expect(new URL(c.url).searchParams.get("maxlag")).toBe("5");
  });

  it("reads ATELIER_CONTACT and strips control characters", () => {
    vi.stubEnv("ATELIER_CONTACT", "ops@example.invalid\r\nX-Evil: 1");
    expect(buildUserAgent()).toBe("AtelierHackathonDemo/0.1 (ops@example.invalid X-Evil: 1)");
  });

  it("recognises placeholders and contactless values", () => {
    expect(isRealContact("your-contact-email-or-project-url")).toBe(false);
    expect(isRealContact("your-name@example.org")).toBe(false);
    expect(isRealContact("ops")).toBe(false);
    expect(isRealContact("ops@example.invalid")).toBe(true);
    expect(isRealContact("https://example.org/atelier")).toBe(true);
  });

  it.each([undefined, "", "   ", "your-contact-email-or-project-url"])(
    "skips Wikidata entirely when the contact is %j: no_contact, no request, no fallback User-Agent",
    async (contact) => {
      vi.stubEnv("ATELIER_CONTACT", contact ?? "");
      const fake = fakeWikidata(WD);
      const ctx = createRefsContext({ fetch: fake.fetch, cache: createMemoryCache(), block: { until: 0 } });
      expect(ctx.wikidata.userAgent).toBeNull();
      const refs = await getReferences(
        entity(62, "film", { properties: { influenced_other_media: ["Fixture Echo"], wikidata_id: "Q9001" } }),
        ctx,
      );
      expect(refs.wikidata).toBe("no_contact");
      expect(refs.lineage.map((l) => l.source)).toEqual(["qloo"]);
      expect(fake.calls).toHaveLength(0);
    },
  );
});

describe("Wikidata politeness", () => {
  it("honors Retry-After across runs through the shared block, until it passes", async () => {
    let t = 1_000_000;
    const shared = { until: 0 };
    const mk = (fake: ReturnType<typeof fakeWikidata>) =>
      createRefsContext({ fetch: fake.fetch, cache: createMemoryCache(), block: shared, contact: CONTACT, now: () => t });
    const limited = fakeWikidata(WD, () => status(429, "120"));
    const first = await getReferences(entity(63, "film", { properties: { wikidata_id: "Q9001" } }), mk(limited));
    expect(first.wikidata).toBe("unavailable");
    expect(shared.until).toBe(t + 120_000);

    const next = fakeWikidata(WD);
    t += 60_000;
    expect((await getReferences(entity(63, "film", { properties: { wikidata_id: "Q9001" } }), mk(next))).wikidata).toBe("unavailable");
    expect(next.calls).toHaveLength(0);

    t += 61_000;
    expect((await getReferences(entity(63, "film", { properties: { wikidata_id: "Q9001" } }), mk(next))).wikidata).toBe("ok");
  });

  it("uses a default pause when a 503 has no Retry-After, and parses date and seconds forms", () => {
    expect(parseRetryAfter("30", 0)).toBe(30_000);
    expect(parseRetryAfter(new Date(5000).toUTCString(), 1000)).toBe(4000);
    expect(parseRetryAfter("soon", 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });

  it("a 503 without Retry-After blocks for the default pause", async () => {
    const block = { until: 0 };
    const fake = fakeWikidata(WD, () => status(503));
    const client = createWikidataClient({ fetch: fake.fetch, cache: createMemoryCache(), block, contact: CONTACT, now: () => 5000 });
    await client.lookup("Q9001", "film");
    expect(block.until).toBe(5000 + 60_000);
  });

  it("a 200 maxlag error is a failure that stops further requests and backs off", async () => {
    const block = { until: 0 };
    const lag = { ok: true, status: 200, json: async () => ({ error: { code: "maxlag", info: "lagged" } }) };
    const fake = fakeWikidata(WD, () => lag);
    const client = createWikidataClient({ fetch: fake.fetch, cache: createMemoryCache(), block, contact: CONTACT, now: () => 0 });
    expect((await client.lookup("Q9001", "film")).status).toBe("unavailable");
    expect((await client.lookup("Q9002", "film")).status).toBe("unavailable");
    expect(fake.calls).toHaveLength(1);
    expect(block.until).toBeGreaterThan(0);
  });

  it("a network failure blocks the rest of the run", async () => {
    const fake = fakeWikidata(WD, () => {
      throw new Error("network down");
    });
    const client = createWikidataClient({ fetch: fake.fetch, ...fresh() });
    await client.lookup("Q9001", "film");
    await client.lookup("Q9002", "film");
    expect(fake.calls).toHaveLength(1);
  });

  it("makes requests one at a time, even when finalists are looked up together", async () => {
    const fake = fakeWikidata(manyItemsFor(4), undefined, 5);
    const ctx = ctxWith(fake);
    const rs = await Promise.all(
      [0, 1, 2, 3].map((i) => getReferences(entity(64 + i, "film", { properties: { wikidata_id: `Q${9200 + i}` } }), ctx)),
    );
    expect(rs.every((r) => r.wikidata === "ok")).toBe(true);
    expect(fake.calls).toHaveLength(8);
    expect(fake.maxInFlight).toBe(1);
  });

  it("stops at the per-run deadline", async () => {
    let t = 0;
    const fake = fakeWikidata(manyItemsFor(3), () => {
      t += 200;
      return undefined;
    });
    const client = createWikidataClient({
      fetch: fake.fetch,
      ...fresh(),
      now: () => t,
      limits: { WIKIDATA_RUN_DEADLINE_MS: 100 },
    });
    // The claims request starts inside the deadline and takes 200 ms; the labels request is then refused.
    expect((await client.lookup("Q9200", "film")).status).toBe("unavailable");
    expect((await client.lookup("Q9201", "film")).status).toBe("unavailable");
    expect(fake.calls).toHaveLength(1);
  });

  it("batches label lookups at 50 ids", async () => {
    const targets = Array.from({ length: 60 }, (_, i) => ({ id: `Q${9500 + i}` }));
    const items: Record<string, { claims?: Record<string, { id: string }[]>; label?: string }> = {
      Q9400: { claims: { P737: targets } },
    };
    for (const t of targets) items[t.id] = { label: `Fixture Parent ${t.id}` };
    const fake = fakeWikidata(items);
    const client = createWikidataClient({
      fetch: fake.fetch,
      ...fresh(),
      limits: { WIKIDATA_MAX_TARGETS_PER_PROPERTY: 60 },
    });
    const out = await client.lookup("Q9400", "film");
    expect(fake.calls.map((c) => c.ids.length)).toEqual([1, 50, 10]);
    expect(out.lineage[0].allNames).toHaveLength(60);
    expect(out.lineage[0].names).toHaveLength(3);
  });
});

describe("nameMatchKey", () => {
  it("ignores a leading article, accents, case, punctuation and '&' versus 'and'", () => {
    expect(nameMatchKey("The Fixture Orchard")).toBe(nameMatchKey("fixture orchard"));
    expect(nameMatchKey("Fixturé Seed")).toBe(nameMatchKey("Fixture Seed"));
    expect(nameMatchKey("Fixture & Seed")).toBe(nameMatchKey("Fixture and Seed"));
    expect(nameMatchKey("Fixture-Seed!")).toBe(nameMatchKey("fixture seed"));
  });

  it("keeps an article inside a name and does not merge different names", () => {
    expect(nameMatchKey("Fixture of the Seed")).toBe("fixture of the seed");
    expect(nameMatchKey("Fixture Seed")).not.toBe(nameMatchKey("Fixture Seeds"));
  });

  it("matches a typed seed without its article against a related name with one", async () => {
    const ctx = ctxWith(fakeWikidata({}));
    const refs = await getReferences(entity(91, "music", { properties: { influenced_by: ["The Fixture Orchard"] } }), ctx);
    expect(lineageTouchingSeeds(refs, ["fixture orchard"])).toHaveLength(1);
  });
});

describe("seed matching uses the full related-name list", () => {
  const props = { influenced_by: ["Fixture A", "Fixture B", "Fixture C", "Fixture D", "Fixture Seed"] };

  it("matches a seed that is not among the 3 shown names, and shows it first when seed names are given", async () => {
    const ctx = ctxWith(fakeWikidata({}));
    const plain = await getReferences(entity(90, "music", { properties: props }), ctx);
    expect(plain.lineage[0].names).toEqual(["Fixture A", "Fixture B", "Fixture C"]);
    expect(plain.lineage[0].allNames).toHaveLength(5);
    expect(lineageTouchingSeeds(plain, ["Fixture Seed"])).toHaveLength(1);

    const seeded = await getReferences(entity(90, "music", { properties: props }), ctx, { seedNames: ["fixture-seed"] });
    expect(seeded.lineage[0].names).toEqual(["Fixture Seed", "Fixture A", "Fixture B"]);
    expect(seeded.lineage[0].hop.label).toBe("Influenced by Fixture Seed, Fixture A and Fixture B");
  });

  it("does the same for Wikidata targets, including on a cached lookup", async () => {
    const targets = ["Q9601", "Q9602", "Q9603", "Q9604", "Q9605"].map((id) => ({ id }));
    const items: Record<string, { claims?: Record<string, { id: string }[]>; label?: string }> = {
      Q9600: { claims: { P737: targets } },
    };
    targets.forEach((t, i) => (items[t.id] = { label: `Fixture Parent ${i}` }));
    const ctx = ctxWith(fakeWikidata(items));
    const e = entity(91, "film", { properties: { wikidata_id: "Q9600" } });
    const first = await getReferences(e, ctx, { seedNames: ["Fixture Parent 4"] });
    expect(first.lineage[0].names[0]).toBe("Fixture Parent 4");
    expect(lineageTouchingSeeds(first, ["Fixture Parent 4"])).toHaveLength(1);
    const cached = await getReferences(e, ctx, { seedNames: ["Fixture Parent 3"] });
    expect(cached.wikidata).toBe("cached");
    expect(cached.lineage[0].names[0]).toBe("Fixture Parent 3");
  });
});

describe("readings", () => {
  const style =
    "Fixture style: saturated colour and slow, held shots. The second sentence gives the excerpt a clean end. A third sentence continues well past the limit so the excerpt has to stop before it, which it does at a sentence boundary instead of in the middle of a word or a thought, as the limit allows.";

  it.each(["film", "tv", "fashion"] as const)("%s: an excerpt of style_description, labeled a reading", (field) => {
    const r = readingFor(entity(70, field, { properties: { style_description: style } }))!;
    expect(r.label).toBe("a reading");
    expect(style.startsWith(r.text)).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(280);
    expect(r.text.endsWith(".")).toBe(true);
    expect(r.source).toBe("qloo");
    expect(r.sourceLabel).toBe("Qloo");
    expect(r.sourceUrl).toBe(QLOO_SOURCE_URL);
    expect(r.license).toBe("Qloo data, shown under the hackathon API terms");
  });

  it("never comes from biography, description or plot_summary, in any field", () => {
    const prose = "A long enough passage of invented text that would qualify as a reading if the key were allowed.";
    for (const f of ["music", "film", "tv", "books", "food_places", "fashion"] as const) {
      const props = { biography: prose, description: prose, plot_summary: prose, plot_description: prose };
      expect(readingFor(entity(71, f, { properties: props }))).toBeNull();
    }
  });

  it("is omitted for music, books and places even with style_description, and when text is missing, short or not a string", () => {
    for (const f of ["music", "books", "food_places"] as const) {
      expect(readingFor(entity(72, f, { properties: { style_description: style } }))).toBeNull();
    }
    expect(readingFor(entity(73, "film", { properties: {} }))).toBeNull();
    expect(readingFor(entity(74, "film", { properties: { style_description: "Too short." } }))).toBeNull();
    expect(readingFor(entity(75, "tv", { properties: { style_description: ["a", "b"] } }))).toBeNull();
    expect(readingFor(entity(76, "film"))).toBeNull();
  });

  it("strips markup, and cuts a long unbroken passage at a word with an ellipsis", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const out = excerpt(`<p>${words}</p>`)!;
    expect(out.endsWith("\u2026")).toBe(true);
    expect(out).not.toContain("<");
    expect(words.startsWith(out.slice(0, -1))).toBe(true);
    expect(out.length).toBeLessThanOrEqual(281);
  });

  it("does not cut at common abbreviations or initials", () => {
    const text =
      "Fixture director Dr. J. Example worked with Mr. Sample, e.g. on invented sets, vs. rivals, etc. in the early years of a long invented career. " +
      "A second sentence follows here and runs on past the limit so that the cut has to fall somewhere before the end of the passage.";
    const out = excerpt(text, 160)!;
    expect(out.endsWith("career.")).toBe(true);
  });

  it("keeps a closing quote or bracket with the sentence end", () => {
    const text =
      'The invented critic called it "a slow burn." Then the second sentence runs past the limit with plenty of extra words to fill the space up.';
    expect(excerpt(text, 60, 20)).toBe('The invented critic called it "a slow burn."');
    expect(excerpt("The set was spare (almost bare.) Then more words follow to pass the limit easily.", 40, 20)).toBe(
      "The set was spare (almost bare.)",
    );
  });
});

describe("helpers", () => {
  it("lineageTouchingSeeds matches seed names after folding case and punctuation", async () => {
    const refs = await getReferences(
      entity(80, "music", { properties: { influenced_by: ["Fixture Elder", "Fixture Peer"] } }),
      ctxWith(fakeWikidata({})),
    );
    expect(lineageTouchingSeeds(refs, ["fixture-elder!"])).toHaveLength(1);
    expect(lineageTouchingSeeds(refs, ["Someone Else"])).toEqual([]);
  });

  it("refsTraceFields counts sourced hops, never inferred, and dedupes source urls", async () => {
    const ctx = ctxWith(fakeWikidata(WD));
    const a = await getReferences(entity(81, "music", { properties: { influenced_by: ["Fixture Elder"] } }), ctx);
    const b = await getReferences(entity(82, "music", { properties: { artists_influenced: ["Fixture Younger"] } }), ctx);
    expect(refsTraceFields([a, b])).toEqual({ sourcedCount: 2, inferredCount: 0, sourceUrls: [QLOO_SOURCE_URL] });
  });

  it("makes no Qloo call: the layer imports nothing from the Qloo client and names no Qloo host", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from ["']@\/lib\/qloo/);
      expect(src, f).not.toMatch(/api\.qloo\.com/);
    }
    expect(synthetic(1)).toMatch(/^00000000-0000-4000-8000-0000000000\d\d$/);
  });
});
