# Contracts: seed, profile, path, card, trace

Starting shape for the shared contracts in `src/types/` (ticket T-02 owns them). Change them through the manager, because many tickets depend on them. Names are a proposal.

```ts
// Locked after the spike (Oct 19). Fields beyond the first six only if Qloo coverage is real.
type Field = 'music' | 'film' | 'tv' | 'books' | 'food_places' | 'fashion';

interface Seed {
  id: string;
  field: Field;
  typed: string;                 // what the user typed
  why: string;                   // the user's one-line reason
  qlooId: string | null;
  resolution: 'resolved' | 'ambiguous' | 'missing';
  candidates?: { qlooId: string; label: string }[];   // when ambiguous
}

interface ProfileTag {
  tag: string;                   // Qloo tag_id, never invented
  name: string;                  // Qloo's tag name
  weight: number;
  fields: Field[];
  appliesTo: string[];           // the tag's `types` (entity types it applies to), used to find bridge tags
  source: 'taste_analysis' | 'seed_detail' | 'why_search';
  rarity: number;
}
interface Axis { id: string; label: string; weight: number; tags: ProfileTag[] }

type Provenance = 'sourced' | 'inferred';

interface PathHop {
  kind: 'seed' | 'theme' | 'lineage' | 'pick';
  label: string;
  tags?: string[];               // for theme hops
  provenance: Provenance;
  sourceUrl?: string;            // required when provenance is 'sourced'
}

interface Path {
  seedId: string;
  anchor: { contribution: number | null; source: 'qloo_explainability' | 'tag_overlap' };
  hops: PathHop[];               // seed -> theme -> [lineage] -> pick
  sharedTags: string[];
  distinctive: boolean;
}

interface ReachParts { tagDistance: number; obscurity: number; fieldUnfamiliarity: number; reach: number }

interface Pick {
  id: string;
  qlooId: string;
  name: string;
  field: Field;
  popularity: number;
  reach: ReachParts;
  connection: number;
  band: 'calibration' | 'moderate' | 'high' | 'extreme';
  llmBridged: boolean;           // true when the field has no Qloo coverage
  origin: 'primary' | 'backfill' | 'unknown';   // 'unknown' until the spike shows how backfill is marked
  path: Path;
  card: Card;
}

interface Card {
  path: Path;                    // 1. the path
  why: string;                   // 2. why this one, from the path only
  different: string;             // 3. what is different, from the reach parts
  provenance: { sourced: number; inferred: number };   // 4. summary; per-hop detail is in the path
  reading?: { text: string; sourceUrl: string };       // optional lineage or symbolic reading, sourced, labeled a reading
  reaction?: { state: 'later' | 'will_try' | 'explore' | 'not_interested' | 'tried'; words?: string; at: string };
}
```

## Trace events

One JSON object per line, written by the loop, read by the UI's reasoning panel and by the evals. Each has `t` (ISO time), `kind`, and `say` (a human sentence for the UI).

| kind | Carries |
|---|---|
| `resolve_seed` | seedId, resolution (a 404 from `/search` is `missing`), candidate count |
| `extract_tags` | field, tag count |
| `build_axes` | axis ids, tag membership counts |
| `map_why` | seedId, tag ids matched from the user's why, whether semantic search was used |
| `choose_theme` | theme tags, reason |
| `query_insights` | domain, endpoint, params (as sent), result count, whether explainability came back, primary vs backfill counts |
| `score` | domain, candidates scored, how many cleared the floor, popularity summary |
| `requery` | domain, reason code (`too_obvious` `too_weak` `empty` `weak_connection`), param changes |
| `fetch_refs` | pick ids, sourced count, inferred count |
| `relax` | what was relaxed (reach band), why |
| `explain` | pick id |

Traces may contain Qloo data. Write them to `.qloo-private/`, never to a tracked path. Fixtures for evals are synthetic.
