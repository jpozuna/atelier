/*
 * Synthetic mock data for the chart demo and tests. Every name is invented and every id is a placeholder;
 * nothing here came from Qloo. Ids use the synthetic shape 00000000-0000-4000-8000-0000000000NN.
 */
import type { Axis, Band, Field, Pick, ProfileTag } from '@/types';
import { FIELDS } from '@/types';
import { CHART_STRENGTH_CONNECTION } from '@/lib/agent/config';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function tag(n: number, name: string, tagType: string, weight: number): ProfileTag {
  return {
    tag: id(n),
    name,
    tagType,
    affinity: 0.5,
    types: ['urn:entity:placeholder'],
    weight,
    fields: ['music'],
    source: 'taste_analysis',
  };
}

function axis(key: string, label: string, tagType: string, weight: number, tags: ProfileTag[]): Axis {
  return {
    id: `axis-${key}`,
    label,
    labelJustification: `Named from its tags: ${tags.map((t) => t.name).join(', ')}.`,
    weight,
    tagType,
    tags,
  };
}

/** Seven axes. Tag ids 01 to 21. */
export const MOCK_AXES: Axis[] = [
  axis('quiet', 'Quiet interiors', 'theme', 9, [
    tag(1, 'Hushed rooms', 'theme', 4),
    tag(2, 'Slow mornings', 'theme', 3),
    tag(3, 'Domestic stillness', 'theme', 2),
  ]),
  axis('craft', 'Handmade craft', 'style', 7, [
    tag(4, 'Visible labor', 'style', 3),
    tag(5, 'Worn materials', 'style', 2),
    tag(6, 'Small workshops', 'style', 2),
  ]),
  axis('weather', 'Weather and coast', 'theme', 5, [
    tag(7, 'Grey shoreline', 'theme', 3),
    tag(8, 'Fog and rain', 'theme', 2),
    tag(9, 'Harbour towns', 'theme', 1),
  ]),
  axis('memory', 'Memory and loss', 'emotional_tone', 8, [
    tag(10, 'Elegy', 'emotional_tone', 4),
    tag(11, 'Faded photographs', 'emotional_tone', 2),
    tag(12, 'Inherited objects', 'emotional_tone', 2),
  ]),
  axis('ritual', 'Ritual and repetition', 'theme', 4, [
    tag(13, 'Daily practice', 'theme', 2),
    tag(14, 'Seasonal rites', 'theme', 1),
    tag(15, 'Looping forms', 'theme', 1),
  ]),
  axis('austere', 'Austere line', 'style', 6, [
    tag(16, 'Spare composition', 'style', 3),
    tag(17, 'Muted palette', 'style', 2),
    tag(18, 'Negative space', 'style', 1),
  ]),
  axis('wander', 'Solitary travel', 'theme', 3, [
    tag(19, 'Night trains', 'theme', 1),
    tag(20, 'Unmapped streets', 'theme', 1),
    tag(21, 'Lone walkers', 'theme', 1),
  ]),
];

const SEED_NAMES = ['Seed Alpha', 'Seed Bravo', 'Seed Charlie', 'Seed Delta', 'Seed Echo', 'Seed Foxtrot'];
const THEME_WORDS = ['quiet craft', 'grey light', 'slow loss', 'worn surfaces', 'repeated gestures', 'spare lines'];
const ADJ = ['Amber', 'Brindle', 'Cinder', 'Dovetail', 'Ember', 'Fallow', 'Gilt', 'Hollow', 'Ivory', 'Juniper'];
const NOUN = ['Study', 'Harbour', 'Ledger', 'Orchard', 'Vessel', 'Atlas', 'Cabinet', 'Almanac', 'Chorus', 'Lantern'];

const BANDS: Band[] = ['moderate', 'high', 'extreme'];

/** Deterministic pseudo-random in [0, 1), so the mock never changes between renders. */
function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Build `count` synthetic picks spread over the axes and fields. Entity ids 41 to 70, tag ids 01 to 21 only. */
export function makeMockPicks(count: number): Pick[] {
  return Array.from({ length: count }, (_, k): Pick => {
    const n = k + 1;
    const field: Field = FIELDS[k % FIELDS.length];
    const axisIdx = Math.floor(rand(n) * MOCK_AXES.length);
    const axisB = (axisIdx + 1 + Math.floor(rand(n + 100) * 3)) % MOCK_AXES.length;
    const shared = [MOCK_AXES[axisIdx].tags[k % 3].tag];
    if (k % 4 === 0) shared.push(MOCK_AXES[axisB].tags[0].tag);
    const reach = Math.min(0.98, 0.08 + rand(n + 7) * 0.9);
    // Cycles light, steady, strong, so every mock set (even six picks) draws all three line weights.
    const connection = [CHART_STRENGTH_CONNECTION.light, CHART_STRENGTH_CONNECTION.steady, CHART_STRENGTH_CONNECTION.strong][k % 3];
    const name = `${ADJ[k % ADJ.length]} ${NOUN[(k * 3 + 1) % NOUN.length]}`;
    const seedName = SEED_NAMES[k % SEED_NAMES.length];
    const theme = THEME_WORDS[axisIdx % THEME_WORDS.length];
    const llmBridged = field === 'fashion' && k % 2 === 1;
    const withLineage = k % 5 === 2;
    const hops: Pick['path']['hops'] = [
      { kind: 'seed', label: seedName, provenance: llmBridged ? 'inferred' : 'sourced', sourceUrl: llmBridged ? undefined : 'https://example.invalid/seed' },
      { kind: 'theme', label: theme, tags: shared, provenance: 'inferred' },
      ...(withLineage
        ? [{ kind: 'lineage' as const, label: 'a shared workshop tradition', provenance: 'sourced' as const, sourceUrl: 'https://example.invalid/lineage' }]
        : []),
      { kind: 'pick', label: name, provenance: llmBridged ? 'inferred' : 'sourced', sourceUrl: llmBridged ? undefined : 'https://example.invalid/pick' },
    ];
    const sourced = hops.filter((h) => h.provenance === 'sourced').length;
    const path: Pick['path'] = {
      seedId: `seed-${(k % SEED_NAMES.length) + 1}`,
      anchor: { contribution: 0.6, source: 'qloo_explainability' },
      hops,
      sharedTags: shared,
      distinctive: true,
    };
    return {
      id: `pick-${String(n).padStart(2, '0')}`,
      qlooId: id(40 + n),
      name,
      field,
      popularity: 0.2,
      reach: { tagDistance: reach, obscurity: reach, fieldUnfamiliarity: reach, reach },
      connection,
      band: BANDS[Math.min(2, Math.floor(reach * 3))],
      llmBridged,
      origin: 'unknown',
      path,
      card: {
        path,
        why: 'Synthetic placeholder.',
        different: 'Synthetic placeholder.',
        provenance: { sourced, inferred: hops.length - sourced },
      },
    };
  });
}

export const MOCK_PICKS_6: Pick[] = makeMockPicks(6);
export const MOCK_PICKS_30: Pick[] = makeMockPicks(30);
