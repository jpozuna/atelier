import { describe, expect, it } from 'vitest';
import {
  BANDS,
  FIELDS,
  TRACE_EVENT_KINDS,
  isAxis,
  isBand,
  isCard,
  isField,
  isOrigin,
  isPath,
  isPathHop,
  isProfileTag,
  isProvenance,
  isSeed,
  isSeedStatus,
  isTraceEvent,
  isTraceEventKind,
} from './index';
import {
  BAND_EDGES,
  CONNECTION_FLOOR,
  MAX_LIVE_CALLS_PER_RUN,
  MAX_REQUERIES_PER_RUN,
  POOL_POPULARITY_MAX,
  POOL_TAKE,
  REACH_WEIGHTS,
} from '@/lib/agent/config';

// All names and ids are synthetic.
const ID_1 = '00000000-0000-4000-8000-000000000001';
const ID_2 = '00000000-0000-4000-8000-000000000002';
const TAG_1 = 'urn:tag:fixture:theme:one';
const TAG_2 = 'urn:tag:fixture:theme:two';

const tag = (id: string) => ({
  tag: id,
  name: `Fixture ${id}`,
  tagType: 'theme',
  affinity: 0.5,
  types: ['urn:entity:artist', 'urn:entity:movie'],
  weight: 0.4,
  fields: ['music'],
  source: 'taste_analysis',
});

const path = (kinds: string[] = ['seed', 'theme', 'pick']) => ({
  seedId: 'seed-1',
  anchor: { contribution: 0.4, source: 'qloo_explainability' },
  hops: kinds.map((kind) =>
    kind === 'lineage'
      ? { kind, label: `Fixture ${kind}`, provenance: 'sourced', sourceUrl: 'https://example.test/lineage' }
      : { kind, label: `Fixture ${kind}`, provenance: 'inferred' },
  ),
  sharedTags: [TAG_1],
  distinctive: true,
});

const card = () => ({
  path: path(),
  why: 'Fixture why.',
  different: 'Fixture different.',
  provenance: { sourced: 0, inferred: 3 },
});

describe('enum guards', () => {
  it('isField accepts the locked fields only', () => {
    for (const f of FIELDS) expect(isField(f)).toBe(true);
    expect(isField('cars')).toBe(false);
    expect(isField(1)).toBe(false);
  });
  it('isBand accepts the four bands only', () => {
    for (const b of BANDS) expect(isBand(b)).toBe(true);
    expect(isBand('mild')).toBe(false);
  });
  it('isProvenance accepts sourced and inferred only', () => {
    expect(isProvenance('sourced')).toBe(true);
    expect(isProvenance('inferred')).toBe(true);
    expect(isProvenance('mixed')).toBe(false);
  });
  it('isOrigin accepts primary, backfill, unknown', () => {
    expect(isOrigin('unknown')).toBe(true);
    expect(isOrigin('padded')).toBe(false);
  });
  it('isSeedStatus accepts clean, ambiguous, missing', () => {
    expect(isSeedStatus('clean')).toBe(true);
    expect(isSeedStatus('resolved')).toBe(false);
  });
});

describe('isSeed', () => {
  const base = { id: 's1', field: 'music', typed: 'Fixture Artist A', why: 'fixture reason' };
  it('accepts clean, ambiguous and missing seeds', () => {
    expect(isSeed({ ...base, qlooId: ID_1, status: 'clean' })).toBe(true);
    expect(
      isSeed({
        ...base,
        qlooId: null,
        status: 'ambiguous',
        candidates: [
          { qlooId: ID_1, label: 'Fixture Artist A' },
          { qlooId: ID_2, label: 'Fixture Artist B' },
        ],
      }),
    ).toBe(true);
    expect(isSeed({ ...base, qlooId: null, status: 'missing' })).toBe(true);
  });
  it('rejects inconsistent seeds', () => {
    expect(isSeed({ ...base, qlooId: null, status: 'clean' })).toBe(false);
    expect(isSeed({ ...base, qlooId: null, status: 'ambiguous' })).toBe(false);
    expect(isSeed({ ...base, qlooId: null, status: 'resolved' })).toBe(false);
    expect(isSeed({ ...base, field: 'cars', qlooId: null, status: 'missing' })).toBe(false);
    expect(isSeed(null)).toBe(false);
  });
});

describe('isProfileTag and isAxis', () => {
  it('accepts a well-formed tag, with or without rarity', () => {
    expect(isProfileTag(tag(TAG_1))).toBe(true);
    expect(isProfileTag({ ...tag(TAG_1), rarity: 0.7 })).toBe(true);
    expect(isProfileTag({ ...tag(TAG_1), bridge: true })).toBe(true);
    expect(isProfileTag({ ...tag(TAG_1), bridge: 'yes' })).toBe(false);
  });
  it('rejects a tag missing tagType, affinity or types', () => {
    const noType: Record<string, unknown> = { ...tag(TAG_1) };
    delete noType.tagType;
    const noAffinity: Record<string, unknown> = { ...tag(TAG_1) };
    delete noAffinity.affinity;
    expect(isProfileTag(noType)).toBe(false);
    expect(isProfileTag(noAffinity)).toBe(false);
    expect(isProfileTag({ ...tag(TAG_1), types: 'urn:entity:artist' })).toBe(false);
    expect(isProfileTag({ ...tag(TAG_1), source: 'invented' })).toBe(false);
  });
  it('accepts an axis with at least 2 member tags', () => {
    const axis = {
      id: 'a1',
      label: 'Fixture axis',
      labelJustification: 'Fixture justification from listed tags.',
      weight: 0.5, tagType: 'theme', tags: [tag(TAG_1), tag(TAG_2)],
    };
    expect(isAxis(axis)).toBe(true);
    const noJustification: Record<string, unknown> = { ...axis };
    delete noJustification.labelJustification;
    expect(isAxis(noJustification)).toBe(false);
    expect(isAxis({ ...axis, tags: [tag(TAG_1)] })).toBe(false);
    expect(isAxis({ ...axis, tags: [tag(TAG_1), { nope: 1 }] })).toBe(false);
  });
});

describe('isPathHop and isPath', () => {
  it('requires a sourceUrl on sourced hops', () => {
    expect(isPathHop({ kind: 'lineage', label: 'x', provenance: 'sourced', sourceUrl: 'https://example.test/a' })).toBe(true);
    expect(isPathHop({ kind: 'lineage', label: 'x', provenance: 'sourced' })).toBe(false);
    expect(isPathHop({ kind: 'lineage', label: 'x', provenance: 'inferred' })).toBe(true);
    expect(isPathHop({ kind: 'bridge', label: 'x', provenance: 'inferred' })).toBe(false);
    expect(isPathHop({ kind: 'theme', label: 'x', provenance: 'inferred', tags: [1] })).toBe(false);
  });
  it('accepts seed>theme>pick and seed>theme>lineage>pick', () => {
    expect(isPath(path())).toBe(true);
    expect(isPath(path(['seed', 'theme', 'lineage', 'pick']))).toBe(true);
  });
  it('rejects wrong hop order, missing hops and bad anchors', () => {
    expect(isPath(path(['seed', 'pick']))).toBe(false);
    const inferredLineage = path(['seed', 'theme', 'lineage', 'pick']);
    inferredLineage.hops[2] = { kind: 'lineage', label: 'x', provenance: 'inferred' } as never;
    expect(isPath(inferredLineage)).toBe(false);
    expect(isPath(path(['theme', 'seed', 'pick']))).toBe(false);
    // Public paths carry contribution null even for explainability anchors (stripped for hard rule 7).
    expect(isPath({ ...path(), anchor: { contribution: null, source: 'qloo_explainability' } })).toBe(true);
    expect(isPath({ ...path(), anchor: { contribution: null, source: 'tag_overlap' } })).toBe(true);
    expect(isPath({ ...path(), distinctive: 'yes' })).toBe(false);
  });
});

describe('isCard', () => {
  it('accepts a four-part card with optional reading and reaction', () => {
    expect(isCard(card())).toBe(true);
    expect(
      isCard({
        ...card(),
        reading: { text: 'fixture reading', sourceUrl: 'https://example.test/r' },
        reaction: { state: 'will_try', words: 'fixture', at: '2026-10-19T00:00:00Z' },
      }),
    ).toBe(true);
  });
  it('rejects missing parts and bad optional parts', () => {
    const noWhy: Record<string, unknown> = { ...card() };
    delete noWhy.why;
    expect(isCard(noWhy)).toBe(false);
    expect(isCard({ ...card(), provenance: { sourced: 1 } })).toBe(false);
    expect(isCard({ ...card(), reading: { text: 'no source' } })).toBe(false);
    expect(isCard({ ...card(), reading: { text: 'empty source', sourceUrl: '' } })).toBe(false);
    expect(isCard({ ...card(), provenance: { sourced: -1, inferred: 3 } })).toBe(false);
    expect(isCard({ ...card(), provenance: { sourced: 1.5, inferred: 3 } })).toBe(false);
    expect(isCard({ ...card(), provenance: { sourced: 0, inferred: Number.NaN } })).toBe(false);
    expect(isCard({ ...card(), reaction: { state: 'loved', at: 'x' } })).toBe(false);
    expect(isCard({ ...card(), path: path(['seed', 'pick']) })).toBe(false);
  });
});

describe('isTraceEvent', () => {
  const t = '2026-10-19T00:00:00Z';
  const say = 'fixture sentence';
  const valid: Record<string, object> = {
    qloo_call: { endpoint: '/v2/insights', method: 'POST', cached: true },
    resolve_seed: { seedId: 's1', status: 'missing', candidateCount: 0 },
    extract_tags: { field: 'film', tagCount: 12 },
    build_axes: { axisIds: ['a1'], tagCounts: { a1: 3 } },
    map_why: { seedId: 's1', tagIds: [TAG_1], semanticSearch: true },
    choose_theme: { themeTags: [TAG_1], reason: 'fixture' },
    query_insights: {
      domain: 'books',
      endpoint: '/v2/insights',
      params: { 'filter.type': 'urn:entity:book', take: 50 },
      resultCount: 40,
      explainability: true,
      primaryCount: 40,
      backfillCount: 0,
    },
    score: { domain: 'books', scored: 40, clearedFloor: 9, popularity: { min: 0.1, median: 0.3, max: 0.6 } },
    requery: { domain: 'books', reason: 'too_weak', paramChanges: { 'filter.popularity.max': 0.5 } },
    fetch_refs: { pickIds: ['p1'], sourcedCount: 0, inferredCount: 1 },
    relax: { relaxed: 'reach_band', from: 'extreme', to: 'high', reason: 'fixture' },
    explain: { pickId: 'p1' },
  };

  it('has a valid example for every kind', () => {
    expect(Object.keys(valid).sort()).toEqual([...TRACE_EVENT_KINDS].sort());
    for (const kind of TRACE_EVENT_KINDS) {
      expect(isTraceEvent({ t, say, kind, ...valid[kind] }), kind).toBe(true);
    }
  });
  it('rejects missing base fields and unknown kinds', () => {
    expect(isTraceEventKind('explain')).toBe(true);
    expect(isTraceEventKind('think')).toBe(false);
    expect(isTraceEvent({ t, kind: 'explain', pickId: 'p1' })).toBe(false);
    expect(isTraceEvent({ t, say, kind: 'think' })).toBe(false);
  });
  it('rejects bad kind-specific fields', () => {
    expect(isTraceEvent({ t, say, kind: 'qloo_call', endpoint: '/recs', method: 'GET', cached: false })).toBe(false);
    expect(isTraceEvent({ t, say, kind: 'qloo_call', endpoint: '/search', method: 'GET' })).toBe(false);
    expect(isTraceEvent({ t, say, kind: 'qloo_call', endpoint: '/search', cached: false })).toBe(false);
    expect(isTraceEvent({ t, say, kind: 'qloo_call', endpoint: '/search', method: 'PUT', cached: false })).toBe(false);
    expect(isTraceEvent({ t, say, kind: 'requery', domain: 'film', reason: 'bored', paramChanges: {} })).toBe(false);
    expect(isTraceEvent({ t, say, kind: 'relax', relaxed: 'connection', from: 'high', to: 'moderate', reason: 'x' })).toBe(false);
  });
});

describe('agent config', () => {
  it('holds the budget constants the ticket names', () => {
    expect(MAX_REQUERIES_PER_RUN).toBe(2);
    expect(MAX_LIVE_CALLS_PER_RUN).toBe(12);
    expect(POOL_TAKE).toBe(50);
    expect(POOL_POPULARITY_MAX).toBe(0.6);
  });
  it('has reach weights summing to 1 and ascending band edges inside (0, 1)', () => {
    const sum = Object.values(REACH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    const { calibration, moderate, high } = BAND_EDGES;
    expect(0 < calibration && calibration < moderate && moderate < high && high < 1).toBe(true);
    expect(CONNECTION_FLOOR).toBeGreaterThan(0);
  });
});

describe('Path pickOnlyTags and distance', () => {
  it('accepts valid hints and rejects bad ones', async () => {
    const { isPath } = await import('./guards');
    const base = {
      seedId: 's1',
      anchor: { source: 'tag_overlap', contribution: null },
      hops: [
        { kind: 'seed', label: 'Invented Seed', provenance: 'inferred' },
        { kind: 'theme', label: 'Fixture theme', provenance: 'inferred', tags: ['urn:tag:fixture:a:b'] },
        { kind: 'pick', label: 'Invented Pick', provenance: 'inferred' },
      ],
      sharedTags: ['urn:tag:fixture:a:b'],
      distinctive: true,
    };
    expect(isPath({ ...base, pickOnlyTags: ['urn:tag:fixture:a:c'], distance: ['other_field', 'less_familiar'] })).toBe(true);
    expect(isPath({ ...base, distance: ['far'] })).toBe(false);
    expect(isPath({ ...base, pickOnlyTags: ['a', 'b', 'c', 'd'] })).toBe(false);
  });
});
