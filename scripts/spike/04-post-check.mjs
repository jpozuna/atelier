// Does POST /v2/insights honor filter.popularity.max, feature.explainability and filter.exclude.entities in the body?
// One POST per domain (6 calls), compared with the cached GET at filter.popularity.max=0.6.
import { DOMAINS, ents, q, readPriv, writePriv } from "./lib.mjs";

const { resolved } = readPriv("resolved.json");
const F = {};
for (const [d, T] of Object.entries(DOMAINS)) {
  const seeds = resolved[d].map((s) => s.entity_id).filter(Boolean);
  const get = ents(await q("/v2/insights", { take: 20, "filter.type": T, "signal.interests.entities": seeds, "filter.popularity.max": 0.6 }));
  const excluded = get.slice(0, 3).map((e) => e.entity_id);
  const post = await q("/v2/insights", {}, { method: "POST", body: { "filter.type": T, "signal.interests.entities": seeds.map((id) => ({ id, weight: 1 })), "filter.popularity.max": 0.6, "feature.explainability": true, "filter.exclude.entities": excluded, take: 20 } });
  if (post.dryRun) continue;
  const res = ents(post);
  const expected = get.slice(3).map((e) => e.entity_id);
  F[d] = {
    status: post.status,
    n: res.length,
    popularityMaxHonored: res.every((e) => (e.popularity ?? 0) <= 0.6),
    excludeHonored: res.every((e) => !excluded.includes(e.entity_id)),
    explainabilityPresent: res.filter((e) => e.query?.explainability).length + "/" + res.length,
    sameOrderAsGetMinusExcluded: expected.every((id, i) => res[i]?.entity_id === id),
    err: post.body?.errors ?? null,
  };
}
// Taste analysis by POST (1 call): does the body carry filter.type=urn:tag, the seeds and filter.parents.types?
{
  const seeds = resolved.music.map((s) => s.entity_id).filter(Boolean);
  const getTags = (await q("/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": seeds, take: 50, "filter.parents.types": DOMAINS.music }))?.body?.results?.tags ?? [];
  const post = await q("/v2/insights", {}, { method: "POST", body: { "filter.type": "urn:tag", "signal.interests.entities": seeds.map((id) => ({ id, weight: 1 })), take: 50, "filter.parents.types": DOMAINS.music } });
  if (!post.dryRun) {
    const tags = post.body?.results?.tags ?? [];
    F.tasteAnalysisPost = { status: post.status, n: tags.length, sameAsGet: tags.length === getTags.length && tags.every((t, i) => t.tag_id === getTags[i]?.tag_id), scored: tags.some((t) => typeof t.query?.affinity === "number"), err: post.body?.errors ?? null };
  }
}

writePriv("findings-04.json", F);
console.log(JSON.stringify(F, null, 1));
