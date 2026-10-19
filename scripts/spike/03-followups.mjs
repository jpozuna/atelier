// Follow-ups to 02: corrected POST shape, group weights retry, a fair exclude.tags test, lineage-like properties, tag id formats.
import { DOMAINS, ents, jaccard, median, q, readPriv, sameList, writePriv } from "./lib.mjs";

const { resolved } = readPriv("resolved.json");
const seedIds = Object.fromEntries(Object.entries(resolved).map(([d, l]) => [d, l.map((s) => s.entity_id).filter(Boolean)]));
const idsOf = (r) => ents(r).map((e) => e.entity_id);
const r2 = (x) => (x == null ? null : +x.toFixed(3));
const F = {};

// POST with {id, weight} objects, the shape the 400 asked for. Compared with GET on the same seeds.
const getBase = await q("/v2/insights", { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music, take: 10 });
const postEven = await q("/v2/insights", {}, { method: "POST", body: { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music.map((id) => ({ id, weight: 1 })), take: 10 } });
const postSkew = await q("/v2/insights", {}, { method: "POST", body: { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music.map((id, i) => ({ id, weight: i === 0 ? 10 : 1 })), take: 10, "feature.explainability": true } });
const share0 = (r) => median(ents(r).map((e) => { const a = e.query?.explainability?.["signal.interests.entities"] ?? []; const tot = a.reduce((s, x) => s + x.score, 0); return tot ? (a.find((x) => x.entity_id === seedIds.music[0])?.score ?? 0) / tot : null; }).filter((x) => x != null));
const getExpl = await q("/v2/insights", { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music, take: 10, "feature.explainability": true });
F.post = { evenStatus: postEven.status, evenN: ents(postEven).length, evenEqGet: sameList(idsOf(postEven), idsOf(getBase)), evenJaccardGet: r2(jaccard(idsOf(postEven), idsOf(getBase))), skewStatus: postSkew.status, skewJaccardGet: r2(jaccard(idsOf(postSkew), idsOf(getBase))), seed0ShareGet: r2(share0(getExpl)), seed0ShareSkew: r2(share0(postSkew)), err: postSkew.body?.errors ?? postEven.body?.errors ?? null };

// Group weights retry: one tag instead of three, to avoid the 504.
const film = ents(await q("/v2/insights", { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.film, take: 20 }));
const tagCount = {};
for (const e of film) for (const t of e.tags ?? []) tagCount[t.id] = (tagCount[t.id] ?? 0) + 1;
const common = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
const oneTag = common.find(([, c]) => c >= 5 && c <= 15)?.[0];
const both = { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.music, "signal.interests.tags": oneTag, take: 20 };
const b0 = await q("/v2/insights", both, { noCache: true });
F.groupWeights = { baseStatus: b0.status, baseMs: b0.ms, n: ents(b0).length };
if (b0.status === 200) {
  for (const [k, v] of [["signal.interests.tags.weight", "very_high"], ["signal.interests.tags.weight", "very_low"], ["signal.interests.entities.weight", "very_high"], ["signal.interests.entities.weight", 5]]) {
    const r = await q("/v2/insights", { ...both, [k]: v });
    F.groupWeights[k + "=" + v] = { status: r.status, identical: sameList(idsOf(b0), idsOf(r)), jaccard: r2(jaccard(idsOf(b0), idsOf(r))), withTag: ents(r).filter((e) => (e.tags ?? []).some((t) => t.id === oneTag)).length };
  }
  F.groupWeights.baseWithTag = ents(b0).filter((e) => (e.tags ?? []).some((t) => t.id === oneTag)).length;
}

// filter.exclude.tags with a tag that is actually present in the base results.
const ex = await q("/v2/insights", { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.film, take: 20, "filter.exclude.tags": oneTag });
const filt = await q("/v2/insights", { "filter.type": DOMAINS.film, "signal.interests.entities": seedIds.film, take: 20, "filter.tags": oneTag });
F.excludeTags = { tagInBase: tagCount[oneTag], status: ex.status, n: ents(ex).length, stillWithTag: ents(ex).filter((e) => (e.tags ?? []).some((t) => t.id === oneTag)).length };
F.filterTags = { status: filt.status, n: ents(filt).length, allWithTag: ents(filt).filter((e) => (e.tags ?? []).some((t) => t.id === oneTag)).length };

// Lineage-like property keys and tag-id prefixes per domain (names of fields only).
F.props = {};
for (const [d, T] of Object.entries(DOMAINS)) {
  const r = await q("/v2/insights", { take: 20, "filter.type": T, "signal.interests.entities": seedIds[d] });
  const keys = {};
  for (const e of ents(r)) for (const [k, v] of Object.entries(e.properties ?? {})) if (v != null && !(Array.isArray(v) && !v.length) && v !== "") keys[k] = (keys[k] ?? 0) + 1;
  F.props[d] = { keys, tagIdPrefixes: [...new Set(ents(r).flatMap((e) => (e.tags ?? []).map((t) => (t.id ?? t.tag_id ?? "").split(":").slice(0, 4).join(":"))))].length, tagTypeField: [...new Set(ents(r).flatMap((e) => (e.tags ?? []).map((t) => t.type)))].slice(0, 40) };
}

writePriv("findings-03.json", F);
console.log(JSON.stringify(F, null, 1));
