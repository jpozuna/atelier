// Probes 2-24 and silent-ignore detection. Writes findings (counts, booleans, shapes) to .qloo-private/spike/findings.json.
import { DOMAINS, ents, jaccard, median, q, readPriv, sameList, tags, writePriv } from "./lib.mjs";

const { resolved } = readPriv("resolved.json");
const seedIds = Object.fromEntries(Object.entries(resolved).map(([d, l]) => [d, l.map((s) => s.entity_id).filter(Boolean)]));
const allSeeds = Object.values(seedIds).flat();
const doms = Object.keys(DOMAINS);
const F = {};
const idsOf = (r) => ents(r).map((e) => e.entity_id);
const pops = (r) => ents(r).map((e) => e.popularity);
const ins = (params) => q("/v2/insights", { take: 20, ...params });
const cmp = (a, b) => ({ identical: sameList(idsOf(a), idsOf(b)), jaccard: +jaccard(idsOf(a), idsOf(b)).toFixed(2), nA: ents(a).length, nB: ents(b).length, statusB: b.status });
const r2 = (x) => (x == null ? null : +x.toFixed(3));

// --- Seed detail via /entities (probe 2, 9) ---
const seedDetail = await q("/entities", { entity_ids: allSeeds });
const seedTags = {};
F.entities = { status: seedDetail.status, n: Array.isArray(seedDetail.body?.results) ? seedDetail.body.results.length : null, perDomain: {} };
for (const d of doms) {
  const items = (seedDetail.body?.results ?? []).filter((e) => seedIds[d].includes(e.entity_id));
  seedTags[d] = new Set(items.flatMap((e) => (e.tags ?? []).map((t) => t.tag_id ?? t.id)));
  F.entities.perDomain[d] = {
    n: items.length,
    tagCounts: items.map((e) => e.tags?.length ?? 0),
    tagTypes: [...new Set(items.flatMap((e) => (e.tags ?? []).map((t) => t.type)))].length,
    wikidata: items.filter((e) => e.external?.wikidata || e.properties?.external?.wikidata || e.properties?.wikidata_id).length,
    externalKeys: [...new Set(items.flatMap((e) => Object.keys(e.external ?? e.properties?.external ?? {})))],
    hasInfluencedOtherMedia: items.filter((e) => (e.properties?.influenced_other_media ?? []).length).length,
    propertyKeys: [...new Set(items.flatMap((e) => Object.keys(e.properties ?? {})))],
  };
}

// --- Same-domain base, determinism, popularity (probes 4, 6) ---
F.base = {};
const base = {};
for (const d of doms) {
  const T = DOMAINS[d];
  base[d] = await ins({ "filter.type": T, "signal.interests.entities": seedIds[d] });
  const again = await q("/v2/insights", { take: 20, "filter.type": T, "signal.interests.entities": seedIds[d] }, { noCache: true });
  const p = pops(base[d]).filter((x) => typeof x === "number").sort((a, b) => a - b);
  F.base[d] = {
    status: base[d].status, n: ents(base[d]).length, ms: base[d].ms, bytesPerEntity: Math.round(base[d].bytes / Math.max(1, ents(base[d]).length)),
    deterministic: sameList(idsOf(base[d]), idsOf(again)),
    pop: { min: r2(p[0]), median: r2(median(p)), max: r2(p.at(-1)), shareAbove09: r2(p.filter((x) => x > 0.9).length / (p.length || 1)) },
    affinity: { median: r2(median(ents(base[d]).map((e) => e.query?.affinity))) },
    seedsInResults: idsOf(base[d]).filter((id) => seedIds[d].includes(id)).length,
    entityKeys: [...new Set(ents(base[d]).flatMap((e) => Object.keys(e)))],
    queryKeys: [...new Set(ents(base[d]).flatMap((e) => Object.keys(e.query ?? {})))],
    resultTypes: [...new Set(ents(base[d]).map((e) => e.type))],
    resultSubtypes: [...new Set(ents(base[d]).map((e) => e.subtype))],
    tagKeys: Object.keys(ents(base[d])[0]?.tags?.[0] ?? {}),
    withWikidata: ents(base[d]).filter((e) => e.external?.wikidata || e.properties?.wikidata_id).length,
    withInfluenced: ents(base[d]).filter((e) => (e.properties?.influenced_other_media ?? []).length).length,
    withDescription: ents(base[d]).filter((e) => e.properties?.description || e.properties?.short_description || e.properties?.short_descriptions).length,
    withImage: ents(base[d]).filter((e) => e.properties?.image).length,
    meanTagOverlapWithSeeds: r2(median(ents(base[d]).map((e) => (e.tags ?? []).filter((t) => seedTags[d].has(t.tag_id ?? t.id)).length))),
  };
  F.base[d].popMax = {};
  for (const max of [0.3, 0.6]) {
    const r = await ins({ "filter.type": T, "signal.interests.entities": seedIds[d], "filter.popularity.max": max });
    F.base[d].popMax[max] = { n: ents(r).length, median: r2(median(pops(r))), maxSeen: r2(Math.max(...pops(r).filter((x) => typeof x === "number"), -1)) };
  }
}

// --- Cross-domain matrix (probe 5) ---
F.cross = {};
const cross = {};
for (const a of doms) {
  F.cross[a] = {};
  cross[a] = {};
  for (const b of doms) {
    if (a === b) continue;
    const r = await ins({ "filter.type": DOMAINS[b], "signal.interests.entities": seedIds[a] });
    cross[a][b] = r;
    F.cross[a][b] = { status: r.status, n: ents(r).length, medPop: r2(median(pops(r))), medAff: r2(median(ents(r).map((e) => e.query?.affinity))), ms: r.ms };
  }
}

// --- Frontier emptiness (probe 10): mixed profile -> each type, tight popularity + exclusions ---
F.frontier = {};
for (const d of doms) {
  const others = doms.filter((x) => x !== d).flatMap((x) => seedIds[x]);
  const shown = idsOf(cross[doms.find((x) => x !== d)][d]);
  F.frontier[d] = {};
  for (const max of [0.2, 0.3, 0.5]) {
    const r = await ins({ "filter.type": DOMAINS[d], "signal.interests.entities": others, "filter.popularity.max": max, "filter.exclude.entities": [...allSeeds, ...shown], take: 20 });
    F.frontier[d][max] = { n: ents(r).length, excludedLeaked: idsOf(r).filter((id) => shown.includes(id) || allSeeds.includes(id)).length, medPop: r2(median(pops(r))) };
  }
}

// --- Explainability (probes 8, 11) ---
F.explain = {};
for (const d of doms) {
  const on = await ins({ "filter.type": DOMAINS[d], "signal.interests.entities": seedIds[d], "feature.explainability": true });
  const crossOn = await ins({ "filter.type": DOMAINS[d], "signal.interests.entities": allSeeds.filter((id) => !seedIds[d].includes(id)), "feature.explainability": true });
  const per = (r) => ents(r).map((e) => e.query?.explainability?.["signal.interests.entities"] ?? []);
  const topShare = (r) => median(per(r).map((arr) => { const s = arr.map((x) => x.score ?? x.avg_score ?? 0); const tot = s.reduce((a, b) => a + b, 0); return tot ? Math.max(...s) / tot : null; }).filter((x) => x != null));
  const dominantSeed = (r) => { const c = {}; for (const arr of per(r)) { const top = [...arr].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]; if (top) c[top.entity_id] = (c[top.entity_id] ?? 0) + 1; } return Object.values(c).sort((a, b) => b - a); };
  F.explain[d] = {
    sameIdsAsBase: sameList(idsOf(on), idsOf(base[d])),
    perResultPresent: per(on).filter((a) => a.length).length + "/" + ents(on).length,
    perResultItemKeys: Object.keys(per(on).find((a) => a.length)?.[0] ?? {}),
    topLevelKeys: Object.keys(on.body?.query?.explainability ?? {}),
    warning: on.body?.query?.explainability?.warning ?? null,
    medianTopSeedShare: r2(topShare(on)),
    topSeedCounts: dominantSeed(on),
    cross15Seeds: { perResultPresent: per(crossOn).filter((a) => a.length).length + "/" + ents(crossOn).length, medianContributors: median(per(crossOn).map((a) => a.length)), medianTopSeedShare: r2(topShare(crossOn)), distinctTopSeeds: dominantSeed(crossOn).length },
  };
}

// --- bias.trends and bias.content_based (probes 13, 19) ---
F.bias = {};
for (const d of doms) {
  const P = { "filter.type": DOMAINS[d], "signal.interests.entities": seedIds[d] };
  F.bias[d] = { trends: {}, content: {} };
  for (const v of ["off", "high"]) { const r = await ins({ ...P, "bias.trends": v }); F.bias[d].trends[v] = { ...cmp(base[d], r), medPop: r2(median(pops(r))) }; }
  for (const v of [0, 0.5, 1]) {
    const r = await ins({ ...P, "bias.content_based": v });
    F.bias[d].content[v] = { ...cmp(base[d], r), medPop: r2(median(pops(r))), medTagOverlap: median(ents(r).map((e) => (e.tags ?? []).filter((t) => seedTags[d].has(t.tag_id ?? t.id)).length)) };
  }
  F.bias[d].baseMedPop = r2(median(pops(base[d])));
}

// --- Backfill (probe 18) ---
F.backfill = {};
for (const d of doms) {
  const other = d === "music" ? "film" : "music";
  F.backfill[d] = {};
  for (const [label, P] of [["same", { "filter.type": DOMAINS[d], "signal.interests.entities": seedIds[d] }], ["cross", { "filter.type": DOMAINS[d], "signal.interests.entities": seedIds[other] }]]) {
    const def = await ins({ ...P, take: 50 });
    const low = await ins({ ...P, take: 50, "backfill.cross_domain.take": 1, "backfill.content_based.take": 1 });
    const keySets = new Set(ents(def).map((e) => JSON.stringify(Object.keys(e.query ?? {}).sort())));
    F.backfill[d][label] = { nDefault: ents(def).length, nLow: ents(low).length, identical: sameList(idsOf(def), idsOf(low)), jaccard: r2(jaccard(idsOf(def), idsOf(low))), distinctQueryKeySets: [...keySets], affinityTail: ents(def).slice(-5).map((e) => r2(e.query?.affinity)) };
  }
}

// --- filter.exists, page/offset, sort_by, location, take (probes 13, 17, 21) ---
F.misc = {};
for (const d of doms) {
  const P = { "filter.type": DOMAINS[d], "signal.interests.entities": seedIds[d] };
  const m = (F.misc[d] = {});
  for (const v of ["properties.description", "properties.image"]) m["exists:" + v] = cmp(base[d], await ins({ ...P, "filter.exists": v }));
  const off = await ins({ ...P, offset: 20 });
  const page = await ins({ ...P, page: 2 });
  m.offset20VsBase = cmp(base[d], off);
  m.page2VsBase = cmp(base[d], page);
  m.page2VsOffset20 = cmp(off, page);
  m.sortRating = cmp(base[d], await ins({ ...P, sort_by: "rating" }));
  m.locationQuery = cmp(base[d], await ins({ ...P, "signal.location.query": "New York" }));
  m.take50 = (await ins({ ...P, take: 50 })).status;
  const t51 = await ins({ ...P, take: 51 });
  m.take51 = { status: t51.status, n: ents(t51).length, msg: t51.body?.error?.message ?? null };
}

// --- filter.results.entities (probe 14) ---
F.resultsEntities = {};
for (const d of ["music", "film", "books"]) {
  const P = { "filter.type": DOMAINS[d], "signal.interests.entities": seedIds[d] };
  const off = await ins({ ...P, offset: 20 });
  const supplied = idsOf(off).slice(0, 5);
  const crossIds = idsOf(cross[doms.find((x) => x !== d && DOMAINS[x] !== DOMAINS[d])][d]).slice(-3);
  const r = await ins({ ...P, "filter.results.entities": [...supplied, ...crossIds] });
  F.resultsEntities[d] = { status: r.status, n: ents(r).length, allSupplied: idsOf(r).every((id) => supplied.includes(id) || crossIds.includes(id)), returnedOfSupplied: idsOf(r).filter((id) => supplied.includes(id) || crossIds.includes(id)).length + "/" + (supplied.length + crossIds.length), haveAffinity: ents(r).filter((e) => typeof e.query?.affinity === "number").length };
}

// --- Taste analysis (probe 15) and bridge tags (probes 7, 24) ---
F.taste = {};
const tasteTags = {};
for (const d of doms) {
  const P = { "filter.type": "urn:tag", "signal.interests.entities": seedIds[d], take: 50 };
  const r = await q("/v2/insights", P);
  const list = tags(r);
  tasteTags[d] = list;
  const withParents = await q("/v2/insights", { ...P, "filter.parents.types": DOMAINS[d] });
  const subtypes = [...new Set(list.map((t) => t.subtype))];
  const withTagTypes = await q("/v2/insights", { ...P, "filter.tag.types": subtypes.find((s) => /keyword/.test(s ?? "")) ?? subtypes[0] });
  F.taste[d] = {
    status: r.status, n: list.length, ms: r.ms,
    tagKeys: Object.keys(list[0] ?? {}), queryKeys: Object.keys(list[0]?.query ?? {}),
    scored: list.some((t) => typeof t.query?.affinity === "number" || typeof t.query?.score === "number"),
    distinctSubtypes: subtypes.length,
    typesPerTagMedian: median(list.map((t) => t.types?.length ?? 0)),
    parentsTypes: { status: withParents.status, ...cmpTags(list, tags(withParents)) },
    tagTypes: { status: withTagTypes.status, ...cmpTags(list, tags(withTagTypes)), allMatchFilter: tags(withTagTypes).every((t) => t.subtype === (subtypes.find((s) => /keyword/.test(s ?? "")) ?? subtypes[0])) },
    overlapWithSeedEntityTags: list.filter((t) => seedTags[d].has(t.tag_id)).length,
  };
}
function cmpTags(a, b) { const A = a.map((t) => t.tag_id), B = b.map((t) => t.tag_id); return { n: B.length, identical: sameList(A, B), jaccard: r2(jaccard(A, B)) }; }
F.tasteDiffersAcrossSeedSets = Object.fromEntries(doms.slice(1).map((d) => [d, r2(jaccard(tasteTags.music.map((t) => t.tag_id), tasteTags[d].map((t) => t.tag_id)))]));
F.tasteNoSignal = (await q("/v2/insights", { "filter.type": "urn:tag", take: 20 })).status;
const heat = await q("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": seedIds.music, "filter.location.query": "New York" });
F.heatmap = { status: heat.status, msg: heat.body?.error?.message ?? null };

// Bridge tags: share of each domain's taste tags whose `types` include another domain's entity type; plus raw seed-tag id overlap.
F.bridge = {};
for (const a of doms) {
  F.bridge[a] = {};
  for (const b of doms) {
    if (a === b) continue;
    const list = tasteTags[a];
    F.bridge[a][b] = { typesShare: r2(list.filter((t) => (t.types ?? []).includes(DOMAINS[b])).length / (list.length || 1)), seedTagIdOverlap: [...seedTags[a]].filter((x) => seedTags[b].has(x)).length };
  }
}
F.tagNamespaces = Object.fromEntries(doms.map((d) => [d, [...new Set(tasteTags[d].map((t) => (t.tag_id ?? "").split(":").slice(0, 4).join(":")))]]));

// --- Tag operator and group weights (probes 12, 20) ---
const pickTags = tasteTags.music.filter((t) => (t.types ?? []).includes(DOMAINS.film)).slice(0, 3).map((t) => t.tag_id);
F.tagOperator = { nTags: pickTags.length };
if (pickTags.length >= 2) {
  const P = { "filter.type": DOMAINS.film, "signal.interests.tags": pickTags };
  const none = await ins(P), uni = await ins({ ...P, "operator.signal.interests.tags": "union" }), inter = await ins({ ...P, "operator.signal.interests.tags": "intersection" });
  F.tagOperator = { nTags: pickTags.length, none: ents(none).length, union: ents(uni).length, intersection: ents(inter).length, noneEqUnion: sameList(idsOf(none), idsOf(uni)), noneEqIntersection: sameList(idsOf(none), idsOf(inter)), status: [none.status, uni.status, inter.status] };
  const both = { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music, "signal.interests.tags": pickTags, "operator.signal.interests.tags": "union" };
  const b0 = await ins(both);
  F.groupWeights = {
    tagsVeryHigh: cmp(b0, await ins({ ...both, "signal.interests.tags.weight": "very_high" })),
    tagsVeryLow: cmp(b0, await ins({ ...both, "signal.interests.tags.weight": "very_low" })),
    entitiesVeryHigh: cmp(b0, await ins({ ...both, "signal.interests.entities.weight": "very_high" })),
    entitiesNumeric5: cmp(b0, await ins({ ...both, "signal.interests.entities.weight": 5 })),
  };
  F.filterTags = { union: cmp(cross.music.film, await ins({ "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music, "filter.tags": pickTags })), exclude: cmp(cross.music.film, await ins({ "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music, "filter.exclude.tags": pickTags.slice(0, 1) })) };
}

// --- Semantic tag search (probe 22) ---
const why = "slow melancholy late night city loneliness and longing";
F.semantic = {};
for (const [label, P] of [["plain", { "filter.query": why }], ["semantic", { "filter.query": why, "feature.semantic_search": true }], ["semanticTypo", { "filter.query": "melancoly longng", "feature.semantic_search": true, "feature.typo_tolerance": true }], ["typoOnly", { "filter.query": "melancoly", "feature.typo_tolerance": true }], ["semanticMovie", { "filter.query": why, "feature.semantic_search": true, "filter.parents.types": DOMAINS.film }]]) {
  const r = await q("/v2/tags", { take: 20, ...P }, { noCache: label === "semantic" });
  F.semantic[label] = { status: r.status, n: tags(r).length, ms: r.ms, tagKeys: Object.keys(tags(r)[0] ?? {}), subtypes: [...new Set(tags(r).map((t) => t.subtype ?? t.type))].length };
}

// --- POST once (probe 16) ---
const post = await q("/v2/insights", {}, { method: "POST", body: { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music.map((entity, i) => ({ entity, weight: i === 0 ? 10 : 1 })), take: 10 } });
F.post = { status: post.status, n: ents(post).length, msg: post.body?.error?.message ?? post.body?._raw ?? null };

// --- Errors, latency, parallel (operational) ---
const bad = await q("/v2/insights", { "filter.type": "urn:entity:music", "signal.interests.entities": seedIds.music });
F.errors = { unsupportedType: { status: bad.status, msg: bad.body?.error?.message ?? null } };
// Recorded 2026-10-18: no key -> 401. Raw fetch bypasses the cache and budget, so it only runs live.
F.errors.noKey = process.env.QLOO_LIVE === "1" ? (await fetch("https://hackathon.api.qloo.com/v2/insights?filter.type=urn:entity:movie")).status : 401;
const t0 = performance.now();
const par = await Promise.all(doms.slice(0, 5).map((d) => q("/v2/insights", { "filter.type": DOMAINS[d], "signal.interests.entities": seedIds[d], take: 20 }, { noCache: true })));
F.parallel5 = { wallMs: Math.round(performance.now() - t0), each: par.map((r) => r.ms), statuses: par.map((r) => r.status), rateHeaders: par[0].headers };

writePriv("findings.json", F);
console.log(JSON.stringify(F, null, 1));
