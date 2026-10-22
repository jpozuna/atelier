// Synthetic Qloo for local testing: a fetch replacement that answers /search, /entities, /v2/tags and /v2/insights
// with invented data, in process, with no network. Turned on by QLOO_SYNTHETIC=1 (see createQlooClient); refused on
// Vercel. The real client still validates params, parses envelopes and counts calls, so the app runs end to end.
//
// Everything is invented: names from word lists, tag ids urn:tag:<kind>:synthetic:<value>, entity ids shaped
// 00000000-0000-4000-8000-NNNNNNNNNNNN. No Qloo data. Answers are deterministic per request so a repeat view looks
// the same. Entities seen in this process are remembered so /entities and taste analysis can find their tags.

import "server-only";

import { REGISTRY, type Registry } from "./registry";
import type { SeedSignal } from "./types";

/** True when the app should answer Qloo calls from this module. Never on Vercel. */
export const isSynthetic = (env: Record<string, string | undefined> = process.env) => env.QLOO_SYNTHETIC === "1" && !env.VERCEL;

/**
 * The registry for this process. In synthetic mode the POST body gate is opened on a copy for the three params the
 * pool sends (as the agent tests do), since nothing reaches Qloo. Otherwise the real registry, gate unchanged.
 */
export function activeRegistry(env: Record<string, string | undefined> = process.env): Registry {
  if (!isSynthetic(env)) return REGISTRY;
  return { ...REGISTRY, post: { ...REGISTRY.post, confirmedBodyParams: ["filter.popularity.max", "filter.exclude.entities", "feature.explainability"] } };
}

interface SynthTag {
  id: string;
  name: string;
  type: string;
  /** Entity types the tag applies to. */
  types: string[];
  popularity: number;
}

interface SynthEntity {
  id: string;
  name: string;
  type: string;
  tags: SynthTag[];
  popularity: number;
  year: number;
}

const ARTIST = "urn:entity:artist";
const MOVIE = "urn:entity:movie";
const TV = "urn:entity:tv_show";
const BOOK = "urn:entity:book";
const PLACE = "urn:entity:place";
const BRAND = "urn:entity:brand";
const ALL_TYPES = [ARTIST, MOVIE, TV, BOOK, PLACE, BRAND];

// ---- deterministic randomness --------------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

function sample<T>(r: () => number, xs: readonly T[], n: number): T[] {
  const copy = [...xs];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]!);
  return out;
}

const synthId = (key: string) => `00000000-0000-4000-8000-${String(hash(key) % 1e12).padStart(12, "0")}`;

// ---- tag vocabulary ------------------------------------------------------------------------------------------

/** Eight tag types of six values, so taste analysis always has enough types for the chart's axes. */
const VOCAB: Record<string, string[]> = {
  mood: ["Melancholy", "Euphoric", "Brooding", "Tender", "Restless", "Serene"],
  theme: ["Memory", "Exile", "Coming of Age", "Solitude", "Ritual", "Reinvention"],
  style: ["Minimalist", "Baroque", "Lo-Fi", "Brutalist", "Ornate", "Hand-Made"],
  era: ["Seventies", "Fin de Siècle", "Postwar", "Nineties", "Mid-Century", "Near Future"],
  setting: ["Coastal", "Nocturnal Cities", "Rural Quiet", "Desert", "Northern Light", "Old Port Towns"],
  texture: ["Grainy", "Lush", "Austere", "Warm Analog", "Glassy", "Weathered"],
  craft: ["Long Takes", "Field Recording", "Unreliable Narrator", "Slow Cooking", "Tailoring", "Improvisation"],
  sensibility: ["Wry", "Earnest", "Surreal", "Documentary", "Romantic", "Cerebral"],
};

const slug = (s: string) => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const TAGS: SynthTag[] = Object.entries(VOCAB).flatMap(([kind, names]) =>
  names.map((name) => {
    const r = rng(`tag:${kind}:${name}`);
    // Most tags reach three to five entity types, so some carry a theme into fields the user has no seed in.
    const types = sample(r, ALL_TYPES, 3 + Math.floor(r() * 3));
    return { id: `urn:tag:${kind}:synthetic:${slug(name)}`, name, type: `urn:tag:${kind}:synthetic`, types, popularity: 0.05 + r() * 0.9 };
  }),
);
const TAG_BY_ID = new Map(TAGS.map((t) => [t.id, t]));

// ---- invented names ------------------------------------------------------------------------------------------

const ADJ = ["Velvet", "Hollow", "Amber", "Paper", "Silver", "Quiet", "Salt", "Iron", "Lantern", "Willow", "Cobalt", "Ashen", "Golden", "Little", "Northern", "Second"];
const NOUN = ["Orchard", "Harbor", "Static", "Meridian", "Archive", "Garden", "Tide", "Atlas", "Choir", "Signal", "Lantern", "Republic", "Weather", "Ledger", "Mirror", "Season"];

function inventName(type: string, r: () => number): string {
  const a = pick(r, ADJ);
  const n = pick(r, NOUN);
  switch (type) {
    case ARTIST:
      return pick(r, [`${a} ${n}`, `The ${n}s`, `${a} ${n} Ensemble`]);
    case MOVIE:
      return pick(r, [`The ${a} ${n}`, `${n} at Dusk`, `A ${n} for Two`]);
    case TV:
      return pick(r, [`${a} ${n}`, `${n} Street`, `The ${n} Hours`]);
    case BOOK:
      return pick(r, [`A Cartography of ${n}s`, `The ${a} ${n}`, `Notes from the ${n}`]);
    case PLACE:
      return pick(r, [`Café ${n}`, `${a} ${n} Kitchen`, `The ${n} Room`]);
    default:
      return pick(r, [`Maison ${n}`, `${a} & ${n}`, `Atelier ${n}`]);
  }
}

const titleCase = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

// ---- entity memory -------------------------------------------------------------------------------------------

const ENTITIES = new Map<string, SynthEntity>();

function tagsFor(key: string, type: string, n: number): SynthTag[] {
  const r = rng(`tags:${key}`);
  const fit = TAGS.filter((t) => t.types.includes(type));
  return sample(r, fit.length >= n ? fit : TAGS, n);
}

function remember(e: SynthEntity): SynthEntity {
  ENTITIES.set(e.id, e);
  return e;
}

function entityFor(id: string): SynthEntity {
  const known = ENTITIES.get(id);
  if (known) return known;
  const r = rng(`unknown:${id}`);
  const type = pick(r, ALL_TYPES);
  return remember({ id, name: inventName(type, r), type, tags: tagsFor(id, type, 8), popularity: 0.3 + r() * 0.6, year: 1960 + Math.floor(r() * 64) });
}

// ---- endpoint handlers ---------------------------------------------------------------------------------------

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

function search(q: URLSearchParams) {
  const query = (q.get("query") ?? "").trim();
  const type = list(q.get("types"))[0] ?? MOVIE;
  const take = Math.min(Number(q.get("take")) || 5, 10);
  if (!query) return { status: 404, body: { code: 404, reason: "Not Found", message: "No results" } };
  const base = titleCase(query);
  const names = [base, `${base} (Synthetic Edition)`, `The ${base} Variations`].slice(0, take);
  const results = names.map((name, i) => {
    const r = rng(`search:${type}:${name}`);
    const e = remember({
      id: synthId(`${type}:${name.toLowerCase()}`),
      name,
      type,
      tags: tagsFor(`${type}:${name.toLowerCase()}`, type, 8),
      popularity: Math.max(0.2, 0.9 - i * 0.25 - r() * 0.1),
      year: 1960 + Math.floor(r() * 64),
    });
    return {
      name: e.name,
      entity_id: e.id,
      types: [e.type],
      popularity: e.popularity,
      disambiguation: "Synthetic",
      tags: e.tags.map((t) => ({ tag_id: t.id, name: t.name, type: t.type, value: slug(t.name) })),
      properties: { release_year: e.year },
    };
  });
  return { status: 200, body: { success: true, duration: 3, results } };
}

function entities(q: URLSearchParams) {
  const results = list(q.get("entity_ids")).map((id) => {
    const e = entityFor(id);
    return { name: e.name, entity_id: e.id, types: [e.type], popularity: e.popularity, disambiguation: "Synthetic", tags: [], properties: { release_year: e.year } };
  });
  return results.length ? { status: 200, body: { success: true, duration: 2, results } } : { status: 404, body: { code: 404, reason: "Not Found", message: "No results" } };
}

function tags(q: URLSearchParams) {
  const words = new Set((q.get("filter.query") ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const parent = list(q.get("filter.parents.types"))[0];
  const take = Math.min(Number(q.get("take")) || 8, 20);
  const r = rng(`why:${[...words].sort().join(" ")}:${parent}`);
  const scored = TAGS.filter((t) => !parent || t.types.includes(parent))
    .map((t) => {
      const name = t.name.toLowerCase();
      const hit = [...words].some((w) => name.includes(w) || w.includes(name));
      return { t, s: (hit ? 1 : 0) + r() * 0.5 };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.min(take, words.size ? 4 : 0));
  return { status: 200, body: { success: true, duration: 4, results: { tags: scored.map(({ t }) => ({ id: t.id, name: t.name, type: t.type, parents: [] })) } } };
}

function tasteAnalysis(q: URLSearchParams) {
  const seeds = list(q.get("signal.interests.entities")).map(entityFor);
  const take = Math.min(Number(q.get("take")) || 50, 100);
  const r = rng(`taste:${seeds.map((s) => s.id).sort().join(",")}`);
  const boost = new Map<string, number>();
  for (const s of seeds) for (const t of s.tags) boost.set(t.id, (boost.get(t.id) ?? 0) + 1);
  const max = Math.max(1, ...boost.values());
  // Every tag comes back, weighted toward the seeds' own tags, so there are always enough tag types for axes.
  const out = TAGS.map((t) => ({ t, affinity: Math.min(0.99, 0.1 + r() * 0.2 + ((boost.get(t.id) ?? 0) / max) * 0.65) }))
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, take)
    .map(({ t, affinity }) => ({ tag_id: t.id, name: t.name, types: t.types, subtype: t.type, tag_value: slug(t.name), popularity: t.popularity, query: { affinity } }));
  return { status: 200, body: { success: true, duration: 20, results: { tags: out } } };
}

function insightsEntities(body: Record<string, unknown>) {
  const type = String(body["filter.type"]);
  const signals = (Array.isArray(body["signal.interests.entities"]) ? body["signal.interests.entities"] : []) as SeedSignal[];
  const seeds = signals.map((s) => ({ e: entityFor(s.id), w: s.weight ?? 1 }));
  const exclude = new Set(Array.isArray(body["filter.exclude.entities"]) ? (body["filter.exclude.entities"] as string[]) : []);
  const popMax = typeof body["filter.popularity.max"] === "number" ? (body["filter.popularity.max"] as number) : 1;
  const take = Math.min(typeof body.take === "number" ? body.take : 20, 60);
  const explain = body["feature.explainability"] === true;

  // The seeds' tags that apply to this type, weighted by seed weight: candidates share some of these.
  const shared = new Map<string, number>();
  for (const { e, w } of seeds) for (const t of e.tags) if (t.types.includes(type)) shared.set(t.id, (shared.get(t.id) ?? 0) + w);
  const sharedTags = [...shared.keys()].map((id) => TAG_BY_ID.get(id)!);
  const otherTags = TAGS.filter((t) => t.types.includes(type) && !shared.has(t.id));

  const key = `pool:${type}:${seeds.map((s) => s.e.id).sort().join(",")}`;
  const r = rng(key);
  const results = [];
  for (let i = 0; results.length < take && i < take * 2; i++) {
    const id = synthId(`${key}:${i}`);
    if (exclude.has(id)) continue;
    const cr = rng(`${key}:${i}`);
    // Close candidates share three seed tags, far ones share one: a spread across the frontier.
    const nShared = sharedTags.length ? 1 + Math.floor(cr() * Math.min(3, sharedTags.length)) : 0;
    const own = [...sample(cr, sharedTags, nShared), ...sample(cr, otherTags, 2 + Math.floor(cr() * 3))];
    const e = remember({ id, name: inventName(type, cr), type, tags: own, popularity: Math.max(0.01, popMax * (0.05 + cr() * 0.95)), year: 1950 + Math.floor(cr() * 75) });
    const overlap = own.filter((t) => shared.has(t.id)).length;
    const affinity = Math.min(0.99, 0.35 + overlap * 0.15 + r() * 0.1);
    const explainability = seeds
      .map(({ e: s }) => ({ entity_id: s.id, score: s.tags.filter((t) => own.some((o) => o.id === t.id)).length / Math.max(1, own.length) }))
      .filter((x) => x.score > 0);
    results.push({
      name: e.name,
      entity_id: e.id,
      type: "urn:entity",
      subtype: type,
      popularity: e.popularity,
      disambiguation: "Synthetic",
      tags: own.map((t) => ({ id: t.id, name: t.name, type: t.type })),
      external: {},
      properties: { release_year: e.year, description: "An invented work for local testing." },
      query: { affinity, ...(explain ? { explainability: { "signal.interests.entities": explainability } } : {}) },
    });
  }
  return { status: 200, body: { success: true, results: { entities: results }, duration: 30 } };
}

// ---- fetch ---------------------------------------------------------------------------------------------------

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch that never leaves the process. Only the four Qloo paths the client allows are answered. */
export function createSyntheticFetch(): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const q = url.searchParams;
    let out: { status: number; body: unknown };
    if (url.pathname === "/search") out = search(q);
    else if (url.pathname === "/entities") out = entities(q);
    else if (url.pathname === "/v2/tags") out = tags(q);
    else if (url.pathname === "/v2/insights") {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        if (body["filter.type"] === "urn:tag") {
          const sig = Array.isArray(body["signal.interests.entities"]) ? (body["signal.interests.entities"] as (string | SeedSignal)[]) : [];
          const ids = sig.map((s) => (typeof s === "string" ? s : s.id)).join(",");
          out = tasteAnalysis(new URLSearchParams({ "signal.interests.entities": ids, take: String(body.take ?? 50) }));
        } else out = insightsEntities(body);
      } else out = q.get("filter.type") === "urn:tag" ? tasteAnalysis(q) : insightsEntities(Object.fromEntries(q));
    } else out = { status: 404, body: { code: 404, reason: "Not Found", message: "unknown synthetic path" } };
    return respond(out.status, out.body);
  };
}
