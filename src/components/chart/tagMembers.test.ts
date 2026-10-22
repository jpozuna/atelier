import { describe, expect, it } from 'vitest';
import type { Pick } from '@/types';
import { MOCK_AXES, MOCK_PICKS_30, MOCK_PICKS_6, makeMockPicks } from './mock';
import { pickHasTag, tagMembers } from './tagMembers';

const withTheme = (pick: Pick, tags: string[], seedId = pick.path.seedId): Pick => ({
  ...pick,
  path: { ...pick.path, seedId, hops: pick.path.hops.map((h) => (h.kind === 'theme' ? { ...h, tags } : h)) },
});

describe('tagMembers', () => {
  const [a, b, c] = makeMockPicks(3);

  it('lists the suggestions whose theme hop carries the tag, in input order', () => {
    const tag = MOCK_AXES[0].tags[0].tag;
    const picks = [withTheme(a, [tag]), withTheme(b, ['other']), withTheme(c, [tag, 'other'])];
    expect(tagMembers(tag, picks).picks.map((p) => p.id)).toEqual([a.id, c.id]);
  });

  it('lists each seed once, named by its seed hop', () => {
    const tag = MOCK_AXES[0].tags[0].tag;
    const picks = [withTheme(a, [tag], 'seed-1'), withTheme(b, [tag], 'seed-1'), withTheme(c, [tag], 'seed-2')];
    const { seeds } = tagMembers(tag, picks);
    expect(seeds.map((s) => s.id)).toEqual(['seed-1', 'seed-2']);
    expect(seeds[0].label).toBe(a.path.hops.find((h) => h.kind === 'seed')!.label);
  });

  it('ignores shared tags that are not on a theme hop', () => {
    const tag = MOCK_AXES[0].tags[0].tag;
    const picks = [{ ...withTheme(a, ['other']), path: { ...withTheme(a, ['other']).path, sharedTags: [tag] } }];
    expect(pickHasTag(picks[0], tag)).toBe(false);
    expect(tagMembers(tag, picks)).toEqual({ seeds: [], picks: [] });
  });

  it('leaves out a seed whose path has no seed hop rather than showing an id', () => {
    const tag = MOCK_AXES[0].tags[0].tag;
    const bare = withTheme(a, [tag]);
    const noSeed = { ...bare, path: { ...bare.path, hops: bare.path.hops.filter((h) => h.kind !== 'seed') } };
    const { seeds, picks } = tagMembers(tag, [noSeed]);
    expect(seeds).toEqual([]);
    expect(picks).toHaveLength(1);
  });

  it('finds something for at least one axis tag in the mock sets, and nothing for an unknown tag', () => {
    for (const set of [MOCK_PICKS_6, MOCK_PICKS_30]) {
      const hits = MOCK_AXES.flatMap((ax) => ax.tags).filter((t) => tagMembers(t.tag, set).picks.length > 0);
      expect(hits.length).toBeGreaterThan(0);
      expect(tagMembers('no-such-tag', set)).toEqual({ seeds: [], picks: [] });
    }
  });
});
