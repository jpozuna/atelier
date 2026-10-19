// Probe 1, 2, 23: resolve seeds with /search, describe item shape, check 404 and take limits.
import { DOMAINS, q, readPriv, writePriv } from "./lib.mjs";

const seeds = readPriv("seeds.json");
const NYC = "40.7128,-74.0060";
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const resolved = {};
const summary = {};
for (const [domain, type] of Object.entries(DOMAINS)) {
  resolved[domain] = [];
  summary[domain] = { clean: 0, ambiguous: 0, missing: 0, ms: [] };
  for (const query of seeds[domain]) {
    const params = { query, types: type, take: 10 };
    if (domain === "places") Object.assign(params, { "filter.location": NYC, "filter.radius": 20 });
    const r = await q("/search", params);
    summary[domain].ms.push(r.ms);
    const results = Array.isArray(r.body?.results) ? r.body.results : [];
    const exact = results.filter((e) => norm(e.name) === norm(query));
    let status = "missing";
    if (exact.length === 1 || (exact.length > 1 && results[0] && norm(results[0].name) === norm(query))) status = exact.length > 1 ? "ambiguous" : "clean";
    else if (results.length) status = "ambiguous";
    summary[domain][status]++;
    const pick = exact[0] ?? results[0];
    resolved[domain].push({ query, status, http: r.status, n: results.length, exactMatches: exact.length, entity_id: pick?.entity_id, name: pick?.name });
  }
}

// Extra domains: no type filter, see which types come back.
const extras = {};
for (const domain of ["architecture", "cars", "theater"]) {
  extras[domain] = [];
  for (const query of seeds[domain]) {
    const r = await q("/search", { query, take: 10 });
    const results = Array.isArray(r.body?.results) ? r.body.results : [];
    extras[domain].push({ query, http: r.status, n: results.length, types: results.map((e) => e.types?.[0]), top: results.slice(0, 3).map((e) => ({ name: e.name, types: e.types, tagCount: e.tags?.length ?? 0 })) });
  }
}

// Operational: 404 behavior, sort_by, take limits.
const ops = {};
const nonsense = await q("/search", { query: "zqxjvplm wrtyghk", types: DOMAINS.music });
ops.nonsense = { status: nonsense.status, body: nonsense.body };
const byPop = await q("/search", { query: seeds.music[0], types: DOMAINS.music, sort_by: "popularity", take: 10 });
const byMatch = await q("/search", { query: seeds.music[0], types: DOMAINS.music, take: 10 });
ops.sortByPopularityChangesOrder = JSON.stringify(byPop.body?.results?.map((e) => e.entity_id)) !== JSON.stringify(byMatch.body?.results?.map((e) => e.entity_id));
for (const take of [100, 199, 200]) {
  const r = await q("/search", { query: "the", types: DOMAINS.film, take });
  ops["take" + take] = { status: r.status, n: Array.isArray(r.body?.results) ? r.body.results.length : null, bytes: r.bytes, ms: r.ms };
}

// Item shape (field names and types only, from the first resolved item of each domain).
const shape = {};
for (const [domain, type] of Object.entries(DOMAINS)) {
  const r = await q("/search", { query: seeds[domain][0], types: type, take: 10, ...(domain === "places" ? { "filter.location": NYC, "filter.radius": 20 } : {}) });
  const it = r.body?.results?.[0];
  if (!it) continue;
  shape[domain] = {
    keys: Object.keys(it),
    propertyKeys: Object.keys(it.properties ?? {}),
    tagKeys: Object.keys(it.tags?.[0] ?? {}),
    tagCount: it.tags?.length ?? 0,
    externalKeys: Object.keys(it.external ?? it.properties?.external ?? {}),
    popularity: typeof it.popularity,
  };
}

writePriv("resolved.json", { resolved, extras });
writePriv("01-summary.json", { summary, ops, shape });
console.log(JSON.stringify({ summary, ops: { ...ops, nonsense: { status: ops.nonsense.status } }, shape }, null, 1));
for (const [d, list] of Object.entries(extras)) console.log(d, list.map((x) => ({ http: x.http, n: x.n, types: x.types })));
