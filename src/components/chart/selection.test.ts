import { describe, expect, it } from 'vitest';
import { resolveSelection } from './selection';

const picks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('resolveSelection', () => {
  it('prefers selectedIds over selectedId', () => {
    expect(resolveSelection(picks, { selectedId: 'a', selectedIds: ['b', 'c'] })).toEqual(['b', 'c']);
  });

  it('keeps the order of selectedIds, drops duplicates and unknown ids', () => {
    expect(resolveSelection(picks, { selectedIds: ['c', 'zzz', 'a', 'c'] })).toEqual(['c', 'a']);
  });

  it('falls back to selectedId when selectedIds is empty', () => {
    expect(resolveSelection(picks, { selectedId: 'a', selectedIds: [] })).toEqual(['a']);
  });

  it('falls back to selectedId when selectedIds matches no pick', () => {
    expect(resolveSelection(picks, { selectedId: 'a', selectedIds: ['nope'] })).toEqual(['a']);
  });

  it('is empty when a controlled caller matches nothing, even if the chart holds its own', () => {
    expect(resolveSelection(picks, { selectedIds: ['nope'], innerId: 'b' })).toEqual([]);
    expect(resolveSelection(picks, { selectedId: null, innerId: 'b' })).toEqual([]);
    expect(resolveSelection(picks, { selectedId: 'nope', innerId: 'b' })).toEqual([]);
  });

  it('uses the chart own selection only when neither prop is passed', () => {
    expect(resolveSelection(picks, { innerId: 'b' })).toEqual(['b']);
    expect(resolveSelection(picks, { innerId: 'nope' })).toEqual([]);
    expect(resolveSelection(picks, {})).toEqual([]);
  });

  it('ignores a selectedId that names no pick', () => {
    expect(resolveSelection(picks, { selectedId: 'nope' })).toEqual([]);
  });
});
